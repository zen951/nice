/**
 * Mail.tm disposable email provider.
 *
 * Uses the Mail.tm REST API (https://api.mail.tm).
 *
 * API:
 *   GET  /domains?page=1  → { hydra:member: [{ domain }] }
 *   POST /accounts        → create account
 *   POST /token           → { token }
 *   GET  /messages?page=1 → { hydra:member: [{ id, from, subject, intro }] }
 *   GET  /messages/:id    → { text, html }
 */
import logger from "../logger.js";
import { generateUsername, generatePassword } from "../parsing/generators.js";
import { makeApi } from "../http/apiClient.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://api.mail.tm";
const TAG = "MailTm";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Mail.tm uses Hydra/JSON-LD for error responses — extract hydra:description first.
const api = makeApi(BASE_URL, {
  errorDetail: (j) => j["hydra:description"] ?? j.message,
});

// Builds the inbox reader used by pollApi, bound to the auth token.
function buildReader(token) {
  return {
    // Fetches the first page of messages and returns lightweight preview objects.
    async fetchMessages() {
      const data = await api("/messages?page=1", { token });
      return (data["hydra:member"] ?? []).map(
        ({ id, from, subject, intro }) => ({
          id,
          preview: [
            from?.name ?? "",
            from?.address ?? "",
            subject ?? "",
            intro ?? "",
          ]
            .join(" ")
            .trim(),
        }),
      );
    },
    // Fetches the full message body and joins text + HTML parts into one string.
    async readMessage(id) {
      const full = await api(`/messages/${id}`, { token });
      const htmlParts = Array.isArray(full.html)
        ? full.html.join("\n")
        : (full.html ?? "");
      return `${full.text ?? ""}\n${htmlParts}`;
    },
  };
}

const getReader = makeGetReader("_mailtmToken", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "mailtm",
    name: "Mail.tm",
    url: BASE_URL,
    description: "@uberip.com",
    apiOnly: true,
  },

  // Creates a Mail.tm account, obtains a Bearer token, and stores both on the store.
  async createEmail(store) {
    logger.info("[MailTm] Fetching available domains...");
    const { "hydra:member": domains = [] } = await api("/domains?page=1");
    if (!domains.length) throw new Error("[MailTm] No domains available.");

    const address = `${generateUsername()}@${domains[0].domain}`;
    const password = generatePassword();
    const credentials = { address, password };

    logger.info(`[MailTm] Creating account: ${address}`);
    await api("/accounts", { method: "POST", body: credentials });

    logger.info("[MailTm] Requesting auth token...");
    const { token } = await api("/token", {
      method: "POST",
      body: credentials,
    });

    store._mailtmToken = token;
    store._mailtmAddress = address;

    logger.info(`[MailTm] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader),
};
