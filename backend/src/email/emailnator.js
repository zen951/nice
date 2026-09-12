/**
 * Emailnator disposable email provider.
 *
 * Generates dot-trick @gmail.com addresses via the Emailnator web API.
 * No session or XSRF token required.
 *
 * API:
 *   POST /api/generate-email { ids: [3] } → { email: "address" }
 *   POST /api/message-list   { email }    → { messages: [{id, from, subject, locked}] }
 *   GET  /api/message/:id                 → { content (HTML) }
 */
import logger from "../logger.js";
import { makeGetReader, createProviderMethods } from "./base.js";
import { DEFAULT_UA } from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = "https://www.emailnator.com";
const TAG = "Emailnator";

const EMAIL_TYPES = { domain: 1, plusGmail: 2, dotGmail: 3, googleMail: 8 };

// ── Helpers ───────────────────────────────────────────────────────────────────

// Sends a GET or POST request to the Emailnator API and returns parsed JSON.
async function apiFetch(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, */*",
      "User-Agent": DEFAULT_UA,
      Referer: `${BASE}/`,
      Origin: BASE,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[${TAG}] ${method} ${path} → ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return res.json();
}

// Builds the inbox reader bound to a specific email address.
function buildReader({ address }) {
  return {
    // Returns unlocked messages only — locked messages are ads/system notices.
    async fetchMessages() {
      const data = await apiFetch("POST", "/api/message-list", {
        email: address,
      });
      return (data?.messages ?? [])
        .filter((m) => !m.locked)
        .map((m) => ({
          id: m.id,
          preview: `${m.from ?? ""} ${m.subject ?? ""}`.trim(),
        }));
    },
    // Fetches the full HTML content for a single message.
    async readMessage(id) {
      const data = await apiFetch(
        "GET",
        `/api/message/${encodeURIComponent(id)}`,
      );
      return data?.content ?? "";
    },
  };
}

const getReader = makeGetReader("_emailnatorCredential", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "emailnator",
    name: "Emailnator",
    url: BASE,
    description: "dot/plus Gmail ",
    apiOnly: true,
  },

  // Generates a new dotGmail address and stores the credential on the store.
  async createEmail(store) {
    logger.info(`[${TAG}] Generating dotGmail address...`);
    const data = await apiFetch("POST", "/api/generate-email", {
      ids: [EMAIL_TYPES.dotGmail],
    });
    const address = typeof data?.email === "string" ? data.email : null;
    if (!address)
      throw new Error(`[${TAG}] No address returned from generate-email.`);
    store._emailnatorCredential = { address };
    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  // Emailnator enforces rate limits if polled too frequently (HTTP 429).
  ...createProviderMethods(TAG, getReader, { pollDelay: 2500, readDelay: 500 }),
};
