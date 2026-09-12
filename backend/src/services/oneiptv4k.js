/**
 * OneIPTV4K free trial registration service (API-based).
 *
 * Flow:
 *   1. GET /free-trial         → CSRF token + session cookies
 *   2. POST /free-trial        → submit name, email, WhatsApp, device type
 *   3. Poll inbox              → wait for 6-digit verification code
 *   4. GET /free-trial/verify  → refresh CSRF token
 *   5. POST /free-trial/verify → submit CSRF + OTP code
 *   6. Poll inbox              → wait for playlist email, extract M3U links
 */
import {
  generateUsername,
  generatePhone,
  buildResult,
} from "../parsing/generators.js";
import {
  createJar,
  get,
  post,
  extractCsrfToken,
} from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://oneiptv4k.com";
const TRIAL_URL = `${BASE_URL}/free-trial`;
const VERIFY_URL = `${BASE_URL}/free-trial/verify`;
const TAG = "OneIPTV4K";
const TRIAL_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extracts the text from an error-banner or alert-danger div.
const extractError = (html) => {
  const match = html.match(
    /<div[^>]*class="[^"]*(?:error-banner|alert-danger)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  return match ? match[1].replace(/<[^>]+>/g, "").trim() : null;
};

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "oneiptv4k",
    name: "OneIPTV4K (No Ml.tm)",
    description: `${TRIAL_HOURS} Hours`,
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const name = generateUsername();
    const whatsapp = generatePhone();
    const jar = createJar();

    // Step 1: GET registration page — capture initial CSRF token and session cookies.
    log(`[${TAG}] Requesting trial registration page via API...`);
    const { text: regPage, status: regStatus } = await get(TRIAL_URL, jar);
    if (regStatus >= 400)
      throw new Error(`HTTP ${regStatus}: Failed to load registration page`);

    const token = extractCsrfToken(regPage);
    if (!token) throw new Error("Could not extract CSRF token.");

    // Step 2: Submit registration form.
    log(`[${TAG}] Submitting registration for ${email}...`);
    const { text: regResult, status: regPostStatus } = await post(
      TRIAL_URL,
      jar,
      {
        _token: token,
        name,
        email,
        whatsapp,
        device_type: "Smart TV (Samsung/LG)",
        message: "",
      },
      TRIAL_URL,
    );

    // A non-redirect response may contain an inline error message.
    if (regPostStatus >= 400) {
      const err = extractError(regResult);
      if (err) throw new Error(`Registration error: ${err}`);
    }
    log(
      `[${TAG}] Registration accepted. Polling inbox for verification code...`,
    );

    // Step 3: Poll inbox for the 6-digit verification code.
    const seenIds = new Set(inboxSeenIds);
    const code = await provider.waitForVerificationCodeEmail(credentialStore, {
      filterText: "Digi Market",
      codeRe:
        /(?:code|verification|confirm(?:ation)?|otp)[^0-9]{0,60}(\d{6})(?!\d)/i,
      seenIds,
      timeout: 120_000,
    });
    if (!code) throw new Error(`[${TAG}] Verification code not received.`);

    // Step 4: GET verify page to obtain a fresh CSRF token.
    log(`[${TAG}] Submitting verification code (${code}) via API...`);
    const { text: verifyPage } = await get(VERIFY_URL, jar, {
      referer: TRIAL_URL,
    });
    const verifyToken = extractCsrfToken(verifyPage) ?? token;

    // Step 5: POST the OTP.
    const { text: verifyResult, status: verifyStatus } = await post(
      VERIFY_URL,
      jar,
      { _token: verifyToken, code: String(code).trim() },
      VERIFY_URL,
    );

    if (verifyStatus >= 400) {
      const err = extractError(verifyResult);
      if (err) throw new Error(`Verification failed: ${err}`);
    }
    log(`[${TAG}] ✅ Email verified successfully.`);

    // Step 6: Poll inbox for the playlist email.
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        filterText: "Digi Market",
        seenIds,
        timeout: 120_000,
      },
    );
    log(
      `[${TAG}] ✅ Done. TV: ${playlists.tvPlaylist ?? "none"}, VOD: ${playlists.vodPlaylist ?? "none"}`,
    );

    return buildResult({
      username: name,
      playlists,
      trialHours: TRIAL_HOURS,
      serviceName: "OneIPTV4K",
    });
  },
};
