/**
 * Dispose.lol disposable email provider (REST API).
 *
 * Generates temporary Gmail addresses via SvelteKit Remote RPCs:
 *   POST /_app/remote/1i1fsx0/getOrCreateMailbox → creates mailbox, issues session JWT cookie
 *   GET  /_app/remote/1i1fsx0/getMailboxMessages → lists received messages
 *   POST /_app/remote/1i1fsx0/getMailboxMessage  → fetches full message content
 */
import logger from "../logger.js";
import { makeGetReader, createProviderMethods } from "./base.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://dispose.lol";
const RPC = `${BASE_URL}/_app/remote/1i1fsx0`;
const TAG = "Dispose.lol";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Builds request headers for SvelteKit RPC calls.
// json=true adds Content-Type: application/json (required for POST RPCs).
const headers = (cookie = "", json = false) => ({
  "User-Agent": UA,
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "x-sveltekit-pathname": "/",
  "x-sveltekit-search": "",
  Accept: "*/*",
  ...(json && { "Content-Type": "application/json" }),
  ...(cookie && { Cookie: cookie }),
});

// Encodes a value as a base64url JSON string (SvelteKit RPC payload format).
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

// Recursively resolves a SvelteKit/Devalue serialised payload back to
// a plain JS object. The format encodes a flat array where numeric values
// are references (indices) into the same array.
function unflatten(data) {
  try {
    const list = typeof data === "string" ? JSON.parse(data) : data;
    if (!Array.isArray(list) || !list.length) return list;
    const hydrate = (i) => {
      const v = typeof i === "number" ? list[i] : i;
      if (!v || typeof v !== "object") return v;
      if (Array.isArray(v)) return v.map(hydrate);
      return Object.fromEntries(
        Object.entries(v).map(([k, idx]) => [k, hydrate(idx)]),
      );
    };
    return hydrate(0);
  } catch {
    return data;
  }
}

// ── Inbox reader ──────────────────────────────────────────────────────────────

// Builds the inbox reader bound to the session JWT cookie.
function buildReader({ cookie }) {
  const payload = b64([{ assignmentId: -1 }]);

  return {
    async fetchMessages() {
      const res = await fetch(`${RPC}/getMailboxMessages?payload=${payload}`, {
        headers: headers(cookie),
      });
      if (!res.ok)
        throw new Error(`[${TAG}] getMailboxMessages → ${res.status}`);
      const data = unflatten((await res.json()).result);
      return (data?.messages ?? []).map((m) => ({
        id: m.id,
        preview: [m.sender, m.subject, m.receivedAt]
          .filter(Boolean)
          .join(" ")
          .trim(),
      }));
    },
    async readMessage(id) {
      try {
        const res = await fetch(`${RPC}/getMailboxMessage`, {
          method: "POST",
          headers: headers(cookie, true),
          body: JSON.stringify({
            payload: b64([{ id: 1, refresh: 2 }, id, true]),
            refreshes: [],
          }),
        });
        if (!res.ok) return "";
        const m = unflatten((await res.json()).result);
        return (
          m?.htmlBodySrcdoc ||
          m?.textBody ||
          m?.html ||
          m?.text ||
          m?.subject ||
          ""
        );
      } catch {
        return "";
      }
    },
  };
}

const getReader = makeGetReader("_disposeLolCredential", TAG, buildReader);

// ── Provider ──────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "disposelol",
    name: "Dispose.lol",
    url: BASE_URL,
    description: "Gmail",
    apiOnly: true,
  },

  // Creates a mailbox, extracts the session JWT from Set-Cookie, and stores both on the store.
  async createEmail(store) {
    logger.info(`[${TAG}] Generating disposable Gmail address via API...`);
    const res = await fetch(`${RPC}/getOrCreateMailbox`, {
      method: "POST",
      headers: headers("", true),
      body: JSON.stringify([{ assignmentId: -1 }]),
    });
    if (!res.ok)
      throw new Error(`[${TAG}] getOrCreateMailbox failed: ${res.status}`);

    const data = unflatten((await res.json()).result);
    const address = data?.address;
    if (!address)
      throw new Error(`[${TAG}] No address returned from getOrCreateMailbox.`);

    // Extract the JWT issued by the server for subsequent inbox requests.
    const match = (res.headers.get("set-cookie") || "").match(
      /dispose_mailbox=(eyJ[a-zA-Z0-9_\-.]+)/,
    );
    store._disposeLolCredential = {
      address,
      cookie: match ? `dispose_mailbox=${match[1]}` : "",
    };

    logger.info(`[${TAG}] Email ready: ${address}`);
    return address;
  },

  ...createProviderMethods(TAG, getReader, { pollDelay: 800, readDelay: 300 }),
};
