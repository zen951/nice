/**
 * TMaily disposable email provider (REST API).
 *
 * API:
 *   GET /domains                  → lists active domains
 *   GET /generate?prefix=&domain= → generates email + sets TMaily_sid cookie
 *   GET /emails?address=<encoded> → polls received messages
 *   GET /message/<id>             → reads full message content
 */
import logger from "../logger.js";
import { makeGetReader, createProviderMethods } from "./base.js";
import { DEFAULT_UA } from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://tmaily.com";
const TAG = "TMaily";

// Set to a specific domain string to skip the /domains fetch.
export const STATIC_DOMAIN = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Builds common request headers, optionally injecting the session cookie.
const headers = (cookie = "") => ({
  "User-Agent": DEFAULT_UA,
  Accept: "application/json, text/plain, */*",
  Referer: `${BASE_URL}/`,
  "sec-ch-ua-platform": '"Windows"',
  "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130"',
  "sec-ch-ua-mobile": "?0",
  ...(cookie && { Cookie: cookie }),
});

// Fetches a random active domain from the API; falls back to a known-good domain.
async function getDomain() {
  if (STATIC_DOMAIN) return STATIC_DOMAIN;
  try {
    const res = await fetch(`${BASE_URL}/domains`, { headers: headers() });
    if (res.ok) {
      const data = await res.json();
      const list = data?.domains ?? (Array.isArray(data) ? data : []);
      if (list.length) return list[Math.floor(Math.random() * list.length)];
    }
  } catch {}
  return "10timer.com";
}

// Generates a random alphanumeric prefix for the email address.
const generatePrefix = () =>
  Math.random().toString(36).substring(2, 9) +
  Math.floor(Math.random() * 900 + 100);

// ── Inbox reader ──────────────────────────────────────────────────────────────

// Builds the inbox reader bound to address + session cookie.
function buildReader({ address, cookie }) {
  // Fetches the inbox list; returns null on network error.
  const fetchList = () =>
    fetch(`${BASE_URL}/emails?address=${encodeURIComponent(address)}`, {
      headers: headers(cookie),
    }).catch(() => null);

  return {
    async fetchMessages() {
      const res = await fetchList();
      if (!res?.ok) return [];
      const list = await res.json().catch(() => []);
      return (Array.isArray(list) ? list : []).map((m) => ({
        id: m.id,
        preview: [m.sender, m.from, m.subject, m.preview]
          .filter(Boolean)
          .join(" ")
          .trim(),
      }));
    },
    async readMessage(id) {
      // Try the list payload first to avoid an extra round-trip.
      const listRes = await fetchList();
      if (listRes?.ok) {
        const list = await listRes.json().catch(() => []);
        const item = Array.isArray(list)
          ? list.find((m) => String(m.id) === String(id))
          : null;
        const body =
          item?.html ||
          item?.text ||
          item?.body ||
          item?.content ||
          item?.preview ||
          item?.subject;
        if (body) return body;
      }
      // Fall back to the individual message endpoint.
      try {
        const msgRes = await fetch(
          `${BASE_URL}/message/${encodeURIComponent(id)}`,
          { headers: headers(cookie) },
        );
        if (msgRes.ok) return await msgRes.text();
      } catch {}
      return "";
    },
  };
}

const getReader = makeGetReader("_tmailyCredential", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tmaily",
    name: "TMaily",
    url: BASE_URL,
    description: "aiqseo/hqpdf/manglgih ...",
    apiOnly: true,
  },

  // Generates a new email address and stores address + session cookie on the store.
  async createEmail(store) {
    logger.info(`[${TAG}] Generating disposable email address via API...`);
    const domain = "aiqseo.com";

    const res = await fetch(
      `${BASE_URL}/generate?prefix=${encodeURIComponent(generatePrefix())}&domain=${encodeURIComponent(domain)}&force=true`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error(`[${TAG}] /generate failed: ${res.status}`);

    const { address } = await res.json();
    if (!address)
      throw new Error(`[${TAG}] No address returned from /generate.`);

    // Extract the session cookie issued by /generate for use in inbox polling.
    const match = (res.headers.get("set-cookie") || "").match(
      /TMaily_sid=[^;]+/,
    );
    store._tmailyCredential = { address, cookie: match?.[0] ?? "" };

    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader, { pollDelay: 800, readDelay: 300 }),
};
