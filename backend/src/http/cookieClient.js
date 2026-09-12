/**
 * cookieClient.js
 *
 * Cookie-aware HTTP client that manually follows redirects so Set-Cookie
 * headers from every 3xx hop are captured — fetch() with redirect:"follow"
 * silently drops cookies set on intermediate redirects.
 *
 * Exports:
 *   createJar()                      — creates an empty cookie jar
 *   mergeCookies(jar, response)      — harvests Set-Cookie headers into jar
 *   cookieStr(jar)                   — serialises jar to Cookie header string
 *   request(method, url, jar, opts?) — core fetch with manual redirect loop
 *   get(url, jar, opts?)             — GET shorthand
 *   post(url, jar, body, referer?)   — POST shorthand (form-encoded)
 *   jsonPost(url, jar, body, opts?)  — POST shorthand (JSON body, jar optional)
 *
 * CSRF helpers (service-agnostic):
 *   extractCsrfToken(html)           — hidden input: name="_token" / "csrf-token" / "csrfmiddlewaretoken"
 *   extractCsrfInlineJs(html)        — inline JS object literal: csrfToken: 'VALUE'
 *   extractInputValue(html, name)    — generic hidden input value by field name
 */

export const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_REDIRECTS = 10;
const DEFAULT_TIMEOUT = 25_000;

// ── Jar helpers ───────────────────────────────────────────────────────────────

// Returns a new empty cookie jar.
export const createJar = () => ({});

// Reads Set-Cookie headers from the response and writes them into jar.
export function mergeCookies(jar, response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

// Joins all jar entries into a single Cookie header string.
export const cookieStr = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

// ── Core request ──────────────────────────────────────────────────────────────

// Fetches a URL and manually follows redirects up to MAX_REDIRECTS hops,
// collecting Set-Cookie headers at every hop.
// POST → 302 re-issues as GET, matching standard browser behaviour.
export async function request(method, url, jar, opts = {}) {
  const {
    body = null,
    referer = null,
    origin = null,
    ua = DEFAULT_UA,
    timeout = DEFAULT_TIMEOUT,
  } = opts;

  const resolvedJar = jar ?? {};
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers = {
      "User-Agent": ua,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: cookieStr(resolvedJar),
    };

    if (currentMethod === "POST") {
      Object.assign(headers, {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: origin ?? new URL(currentUrl).origin,
        Referer: referer ?? currentUrl,
      });
    }

    const res = await fetch(currentUrl, {
      method: currentMethod,
      headers,
      body:
        currentMethod === "POST" && currentBody
          ? new URLSearchParams(currentBody).toString()
          : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
    });

    mergeCookies(resolvedJar, res);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break;
      // Resolve relative Location headers against the current URL.
      currentUrl = new URL(location, currentUrl).href;
      currentMethod = "GET";
      currentBody = null;
      continue;
    }

    return { text: await res.text(), finalUrl: currentUrl, status: res.status };
  }

  throw new Error(`[cookieClient] Too many redirects from ${url}`);
}

// ── Shorthands ────────────────────────────────────────────────────────────────

// GET shorthand.
export const get = (url, jar, opts) => request("GET", url, jar, opts);

// POST shorthand.
export const post = (url, jar, body, referer, opts) =>
  request("POST", url, jar, { body, referer, ...opts });

// JSON POST shorthand — posts a JSON body, harvests cookies if jar provided,
// follows redirects manually, and returns the parsed JSON response (or {} on parse failure).
// jar is optional — pass null/undefined for stateless calls.
// opts.throwOnError (default true) — set false to suppress throws on non-2xx.
export async function jsonPost(url, jar, body, opts = {}) {
  const {
    referer = null,
    origin = null,
    ua = DEFAULT_UA,
    timeout = DEFAULT_TIMEOUT,
    extraHeaders = {},
    throwOnError = true,
  } = opts;

  const resolvedJar = jar ?? {};
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/html, */*;q=0.8",
      "User-Agent": ua,
      Cookie: cookieStr(resolvedJar),
      Origin: origin ?? new URL(url).origin,
      Referer: referer ?? url,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(timeout),
  });

  if (jar) mergeCookies(jar, res);

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (throwOnError && !res.ok)
    throw new Error(data?.error ?? data?.message ?? `HTTP ${res.status}`);

  return data;
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

// Strips HTML tags and returns the first n characters of plain text.
// Useful for turning an error page into a short readable message.
export const errSnippet = (html, n = 120) =>
  html
    .replace(/<[^>]+>/g, " ")
    .slice(0, n)
    .trim();

// Strips HTML tags and collapses whitespace to a single space.
// Use when you need the full cleaned text rather than a truncated snippet.
export const plainText = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

// Strips <script>/<style> blocks and all remaining tags, then collapses whitespace.
// Use for turning full error pages into readable text.
export const stripHtml = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
// Collects all hidden <input> fields from an HTML form into a plain object.
// Returns { [name]: value } for every <input type="hidden"> found.
export function extractHiddenInputs(html) {
  const body = {};
  const tagRe = /<input[^>]+type=["']hidden["'][^>]*>/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const nameM = /name=["']([^"']+)["']/.exec(m[0]);
    const valM = /value=["']([^"']*)["']/.exec(m[0]);
    if (nameM) body[nameM[1]] = valM?.[1] ?? "";
  }
  return body;
}

// ── CSRF helpers ──────────────────────────────────────────────────────────────

// Extracts the CSRF / Laravel _token from various HTML hidden-input patterns
// (name="_token", name="csrf-token", name="csrfmiddlewaretoken").
// Handles both name-before-value and value-before-name attribute orderings.
export const extractCsrfToken = (html) =>
  html.match(
    /name="(?:_token|csrf-token|csrfmiddlewaretoken)"[^>]*value="([^"]+)"/i,
  )?.[1] ||
  html.match(
    /<input[^>]+name="(?:_token|csrf-token|csrfmiddlewaretoken)"[^>]+value="([^"]+)"/i,
  )?.[1] ||
  html.match(/content="([^"]+)"\s+name="csrf-token"/i)?.[1] ||
  html.match(
    /value="([^"]*)"[^>]*name="(?:_token|csrf-token|csrfmiddlewaretoken)"/i,
  )?.[1] ||
  null;

// Extracts a CSRF token injected into a page's inline JS as an object literal,
// e.g.  csrfToken: 'VALUE'
export const extractCsrfInlineJs = (html) =>
  html.match(/csrfToken:\s*['"]([^'"]+)['"]/)?.[1] ?? null;

// Extracts the value of any hidden input field by its name attribute.
// Tries both name-before-value and value-before-name attribute orderings.
export function extractInputValue(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const r1 = new RegExp(`name="${escaped}"[^>]*value="([^"]*)"`, "i").exec(
    html,
  );
  if (r1) return r1[1];
  const r2 = new RegExp(`value="([^"]*)"[^>]*name="${escaped}"`, "i").exec(
    html,
  );
  return r2?.[1] ?? null;
}
