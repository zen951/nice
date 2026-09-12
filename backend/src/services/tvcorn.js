/**
 * TVCorn free trial registration service (API-based).
 *
 * Flow:
 *   1. GET /trial            → session cookies + CSRF token
 *   2. POST /trial/sendOtp   → submit name + email, triggers OTP email
 *   3. Poll inbox            → wait for 6-digit verification code
 *   4. POST /trial/verifyOtp → submit OTP, triggers async account generation
 *   5. Poll /trial/status    → every 3s until status === "completed" or timeout
 */
import {
  generateUsername,
  parseExpiryDate,
  buildResult,
  TVCORN_ALL_COUNTRIES,
} from "../parsing/generators.js";
import {
  createJar,
  mergeCookies,
  cookieStr,
  extractCsrfInlineJs,
} from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://en.tvcorn.com";
const TAG = "TVCorn";
const POLL_INTERVAL = 3_000;
const POLL_TIMEOUT = 180_000;
const TRIAL_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Fetches a TVCorn endpoint, attaching the cookie jar when provided.
const apiFetch = (path, { jar, ...opts } = {}) =>
  fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json, text/html",
      ...(jar && { Cookie: cookieStr(jar) }),
      ...opts.headers,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });

// Polls /trial/status every POLL_INTERVAL ms until the account is ready or timeout expires.
async function pollForAccount(jar, log) {
  const deadline = Date.now() + POLL_TIMEOUT;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    const res = await apiFetch("/trial/status", { jar });
    mergeCookies(jar, res);
    const json = await res.json().catch(() => null);
    log(`[${TAG}] poll → ${JSON.stringify(json)}`);
    if (json?.status === "completed" && json.data) return json.data;
    if (json?.status === "failed")
      throw new Error(json.data?.message ?? "Account generation failed.");
  }
  throw new Error("Account generation timed out.");
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "tvcorn",
    name: "TVCorn (No Ml.tm)",
    description: `${TRIAL_HOURS} Hours`,
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const username = generateUsername();
    const jar = createJar();
    const POST = {
      method: "POST",
      jar,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    };

    // Step 1: Load trial page — capture session cookies and CSRF token.
    const initRes = await apiFetch("/trial");
    mergeCookies(jar, initRes);
    const csrf = extractCsrfInlineJs(await initRes.text());
    if (!csrf)
      throw new Error("Could not extract CSRF token from the trial page.");

    // Step 2: Submit name + email to trigger the OTP verification email.
    const otpBody = new URLSearchParams({
      _token: csrf,
      name: username,
      email,
    });
    TVCORN_ALL_COUNTRIES.forEach((c) => otpBody.append("countries[]", c));
    const otpRes = await apiFetch("/trial/sendOtp", { ...POST, body: otpBody });
    mergeCookies(jar, otpRes);
    const otpJson = await otpRes.json();
    if (otpJson.status !== "true" && otpJson.status !== true)
      throw new Error(
        `OTP request failed: ${otpJson.message ?? "Unknown error"}`,
      );
    log(`[${TAG}] ✅ OTP email sent to ${email}`);

    // Step 3: Wait for the OTP to arrive in the inbox.
    const code = await provider.waitForVerificationCodeEmail(credentialStore, {
      filterText: "tvcorn",
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
    });
    if (!code) throw new Error("Verification code was not received.");
    log(`[${TAG}] ✅ Verification code received: ${code}`);

    // Step 4: Submit OTP — triggers async account generation on the server.
    const verifyRes = await apiFetch("/trial/verifyOtp", {
      ...POST,
      body: new URLSearchParams({ _token: csrf, email, otp: code }),
    });
    mergeCookies(jar, verifyRes);
    const verifyJson = await verifyRes.json();
    if (verifyJson.status === "false" || verifyJson.status === "error")
      throw new Error(
        `OTP verification failed: ${verifyJson.message ?? "Invalid code"}`,
      );
    log(`[${TAG}] ✅ Email verified — waiting for account to be generated…`);

    // Step 5: Poll until the account is ready.
    const data = await pollForAccount(jar, log);
    const m3uLink = data.m3u ?? data.m3u_url ?? data.playlist ?? null;
    log(`[${TAG}] ✅ Account ready — m3u: ${m3uLink ?? "not found"}`);

    const expiryDate = parseExpiryDate(data.expiry);

    return buildResult({
      username: data.username,
      password: data.password,
      tvPlaylist: m3uLink,
      expiryDate,
      serviceName: "TVCorn",
    });
  },
};
