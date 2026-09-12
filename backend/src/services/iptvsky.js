/**
 * IPTVSky — free 24-hour trial via the site's nonce-protected AJAX endpoint.
 *
 * Flow:
 *   1. GET /wp-json/iptvsky-trial/v1/nonce → session cookie + nonce
 *   2. POST /wp-admin/admin-ajax.php → Xtream credentials and playlist link
 */
import {
  generatePhone,
  generateUsername,
  buildM3u,
  buildResult,
} from "../parsing/generators.js";
import {
  createJar,
  get,
  mergeCookies,
  cookieStr,
  DEFAULT_UA,
} from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://iptvsky.ca";
const TRIAL_URL = `${BASE_URL}/trial/`;
const NONCE_URL = `${BASE_URL}/wp-json/iptvsky-trial/v1/nonce`;
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;
const TAG = "IPTVSky";
const TRIAL_HOURS = 24;

// Parses an API response and adds a service-specific error message.
function parseJson(text, error) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`[${TAG}] ${error}`);
  }
}

// Posts the trial form, retrying once when IPTVSky returns its browser gate.
async function submitTrial(jar, form) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(AJAX_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "User-Agent": DEFAULT_UA,
        Origin: BASE_URL,
        Referer: TRIAL_URL,
        Cookie: cookieStr(jar),
      },
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
    mergeCookies(jar, response);
    const text = await response.text();

    if (
      jar.hc_js_gate === "1" ||
      !text.includes("hc_js_gate=1") ||
      !text.includes("Checking your browser")
    )
      return { response, text };
    jar.hc_js_gate = "1";
  }

  throw new Error(`[${TAG}] Browser gate retry failed`);
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: { id: "iptvsky", name: "IPTVSky", description: `${TRIAL_HOURS} Hours` },

  async execute({ email, log = () => {} }) {
    const jar = createJar();

    log(`[${TAG}] Requesting trial nonce...`);
    const nonceResponse = await get(NONCE_URL, jar, { referer: TRIAL_URL });
    if (nonceResponse.status >= 400)
      throw new Error(
        `[${TAG}] Failed to request trial nonce (HTTP ${nonceResponse.status}).`,
      );
    // The nonce binds the form submission to the initial IPTVSky session.
    const nonce = parseJson(
      nonceResponse.text,
      "Invalid trial nonce response.",
    )?.nonce;
    if (!nonce) throw new Error(`[${TAG}] Trial nonce was not returned.`);

    const form = new FormData();
    for (const [key, value] of Object.entries({
      action: "iptvsky_create_trial",
      trial_name: generateUsername(),
      trial_whatsapp: generatePhone(),
      trial_email: email,
      trial_device: "other",
      trial_template: "100003981663766",
      iptvsky_nonce: nonce,
    })) {
      form.append(key, value);
    }

    log(`[${TAG}] Submitting trial claim for ${email}...`);
    const { response, text } = await submitTrial(jar, form);

    const result = parseJson(
      text,
      `Trial endpoint returned non-JSON content (HTTP ${response.status}).`,
    );
    if (!response.ok || !result.success)
      throw new Error(
        `[${TAG}] Trial claim failed: ${result.data?.message ?? `HTTP ${response.status}`}`,
      );

    const { username, password, host, m3u_link: playlist } = result.data ?? {};
    if (!username || !password || !host)
      throw new Error(
        `[${TAG}] Trial response did not include complete credentials.`,
      );

    const m3u = playlist ?? buildM3u(host, username, password);
    log(`[${TAG}] ✅ Trial activated. M3U: ${m3u ?? "not returned"}`);
    return buildResult({
      username,
      password,
      tvPlaylist: m3u,
      allM3uLinks: m3u ? [m3u] : [],
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
