/**
 * HioMail disposable email provider (REST API).
 *
 * Auth model: JWT token from /alias/new is sent as Bearer on every inbox call.
 *
 * API:
 *   POST /api/alias/new?provider=gmail → { alias, token, expires_at }
 *   POST /api/inbox                    → { messages: [{ id, from, subject, html, ... }] }
 */
import logger from "../logger.js";
import { makeGetReader, createProviderMethods } from "./base.js";
import { DEFAULT_UA } from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://hiomail.com";
const TAG = "HioMail";
const PROVIDER = "gmail";

const BASE_HEADERS = {
  "User-Agent": DEFAULT_UA,
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// POSTs to a HioMail endpoint. Injects the Bearer token when provided.
async function hioFetch(path, { token = null, body = null } = {}) {
  const headers = { ...BASE_HEADERS, "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.detail?.message ?? "";
    } catch (_) {}
    throw new Error(
      `[${TAG}] POST ${path} → ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }

  return res.json();
}

// Builds the inbox reader bound to alias + token.
// HioMail embeds full content in the list payload, so readMessage
// re-fetches the inbox and finds the matching message — no separate endpoint needed.
function buildReader({ alias, token }) {
  const fetchInbox = () => hioFetch("/api/inbox", { token, body: { alias } });

  return {
    async fetchMessages() {
      const { messages = [] } = await fetchInbox();
      return messages.map((m) => ({
        id: m.id ?? m.uid ?? String(m.date ?? Math.random()),
        preview: [m.from, m.sender, m.subject, m.snippet, m.preview]
          .filter(Boolean)
          .join(" ")
          .trim(),
      }));
    },
    async readMessage(id) {
      const { messages = [] } = await fetchInbox();
      const msg = messages.find(
        (m) => String(m.id ?? m.uid ?? m.date) === String(id),
      );
      return (
        msg?.html ??
        msg?.text ??
        msg?.body ??
        msg?.content ??
        msg?.snippet ??
        msg?.subject ??
        ""
      );
    },
  };
}

const getReader = makeGetReader("_hiomailCredential", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "hiomail",
    name: "HioMail",
    url: BASE_URL,
    description: "dotGmail",
    apiOnly: true,
  },

  // Requests a new Gmail alias and stores alias + token on the store.
  async createEmail(store) {
    logger.info(`[${TAG}] Requesting new Gmail alias...`);
    const { alias, token, expires_at } = await hioFetch(
      `/api/alias/new?provider=${PROVIDER}`,
    );
    if (!alias)
      throw new Error(`[${TAG}] No alias returned from /api/alias/new.`);
    if (!token)
      throw new Error(`[${TAG}] No token returned from /api/alias/new.`);
    store._hiomailCredential = { alias, token };
    logger.info(
      `[${TAG}] Email ready: ${alias} (expires: ${expires_at ?? "unknown"})`,
    );
    return alias;
  },

  ...createProviderMethods(TAG, getReader, { pollDelay: 1000, readDelay: 400 }),
};
