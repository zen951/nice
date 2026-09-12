/**
 * DropMail disposable email provider.
 *
 * Uses the DropMail public REST API — no auth required.
 *
 * API:
 *   POST /mailbox           → { address }
 *   GET  /mailbox/{address} → { messages: [{ id, from, subject, text, html }] }
 */
import logger from "../logger.js";
import { makeApi } from "../http/apiClient.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://dropmail.click/api/v1/public";
const TAG = "DropMail";

// ── Helpers ───────────────────────────────────────────────────────────────────

const api = makeApi(BASE_URL);

// Builds the inbox reader bound to a specific mailbox address.
// DropMail includes full message content in the list response, so messages
// are cached locally to avoid a second HTTP request in readMessage.
function buildReader(address) {
  let cache = [];

  return {
    // Fetches all messages and caches them for readMessage.
    async fetchMessages() {
      const data = await api(`/mailbox/${encodeURIComponent(address)}`);
      cache = data?.messages ?? [];
      return cache.map((msg) => ({
        id: msg.id,
        preview: [msg.from ?? "", msg.subject ?? ""].join(" ").trim(),
      }));
    },
    // Returns the full message body from the local cache — no extra request.
    async readMessage(id) {
      const msg = cache.find((m) => m.id === id);
      return msg ? `${msg.text ?? ""}\n${msg.html ?? ""}` : "";
    },
  };
}

const getReader = makeGetReader("_dropmailAddress", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "dropmail",
    name: "DropMail",
    url: "https://dropmail.click",
    description: "@dropmail.click",
    apiOnly: true,
  },

  // Creates a new DropMail mailbox and stores the address on the store.
  async createEmail(store) {
    logger.info(`[${TAG}] Creating mailbox...`);
    const data = await api("/mailbox", { method: "POST" });
    const address = data?.address;
    if (!address) throw new Error(`[${TAG}] No address returned from API.`);
    store._dropmailAddress = address;
    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader),
};
