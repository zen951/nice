/**
 * OgoTV — API/fetch-based free trial.
 *
 * Flow:
 *   1. GET  /login/           → session cookie + csrf_token
 *   2. POST /auth/email-step/ { action:"lookup" }   → register/login mode
 *   3. POST /auth/email-step/ { action:"complete" } → create account
 *   4. Poll inbox             → wait for 6-digit verification code
 *   5. POST /auth/email-step/ { action:"verify" }   → confirm code
 *   6. GET  /client/          → dashboard with trial form
 *   7. POST /client/ activate_trial=1               → activates 24-hour trial
 *   8. Parse M3U playlist link from response HTML
 *
 * Note: Steps 2/3/5 POST JSON to /auth/email-step/ — handled by authPost().
 *       Steps 1/6/7 use the shared cookieClient helpers (form-encoded / GET).
 */
import { buildResult } from "../parsing/generators.js";
import {
  extractPlaylists,
  extractCredsFromM3u,
} from "../parsing/extractors.js";
import { createJar, get, post, jsonPost } from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = "https://ogotv.com";
const TAG = "OgoTV";
const TRIAL_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Shorthand for JSON POSTing to /auth/email-step/ with OgoTV-specific headers.
const authPost = (jar, body) =>
  jsonPost(`${BASE}/auth/email-step/`, jar, body, {
    referer: `${BASE}/login/`,
    extraHeaders: { "Accept-Language": "ru-RU,ru;q=0.9" },
    throwOnError: false,
  });

// Extracts the CSRF token from the login page hidden input (id="authCsrfToken").
const authCsrf = (h) =>
  /id="authCsrfToken"[^>]*value="([^"]+)"/.exec(h)?.[1] ??
  /value="([^"]+)"[^>]*id="authCsrfToken"/.exec(h)?.[1] ??
  null;

// Extracts the CSRF token embedded in the dashboard JS (window.clientCsrfToken).
const clientCsrf = (h) =>
  /clientCsrfToken\s*=\s*"([^"]+)"/.exec(h)?.[1] ??
  /name="csrf_token"[^>]*value="([^"]+)"/.exec(h)?.[1] ??
  null;

// Reads the anti-bot form timestamp from the page and subtracts s seconds
// to simulate a realistic form submission delay.
const startedAt = (h, s = 45) => {
  const m = /id="authStartedAt"[^>]*value="(\d+)"/.exec(h);
  return String(m ? +m[1] - s : Math.floor(Date.now() / 1000) - s);
};

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "ogotv",
    name: "OgoTV (Gmails)",
    description: `${TRIAL_HOURS} Hours`,
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const jar = createJar();
    const PASSWORD = "123456";

    // Step 1: Load login page — session cookie + CSRF.
    const { text: loginHtml } = await get(`${BASE}/login/`, jar);
    const csrf = authCsrf(loginHtml);
    if (!csrf) throw new Error(`[${TAG}] CSRF not found`);

    // Step 2: Determine whether the email is a new or existing account.
    const lookup = await authPost(jar, {
      action: "lookup",
      email,
      website: "",
      form_started_at: startedAt(loginHtml),
      csrf_token: csrf,
    });
    if (!lookup.success)
      throw new Error(`[${TAG}] Lookup failed: ${lookup.error}`);

    // Step 3: Register or log in — triggers verification email on new accounts.
    const complete = await authPost(jar, {
      action: "complete",
      mode: lookup.mode ?? "register",
      email,
      password: PASSWORD,
      csrf_token: csrf,
      source: "trial",
      website: "",
      form_started_at: startedAt(loginHtml, 60),
    });
    if (!complete.pending_verification && !complete.success)
      throw new Error(`[${TAG}] Auth failed: ${complete.error}`);

    // Steps 4+5: Verify the 6-digit code sent to the inbox (new registrations only).
    if (complete.pending_verification) {
      log(`[${TAG}] Polling inbox for verification code…`);
      const code = await provider.waitForVerificationCodeEmail(
        credentialStore,
        {
          filterText: "ogo",
          seenIds: new Set(inboxSeenIds),
          timeout: 120_000,
        },
      );
      if (!code) throw new Error(`[${TAG}] Verification code not received.`);
      log(`[${TAG}] ✅ Code: ${code}`);

      const verify = await authPost(jar, {
        action: "verify",
        email,
        code,
        csrf_token: csrf,
        source: "trial",
      });
      if (!verify.success)
        throw new Error(`[${TAG}] Verify failed: ${verify.error}`);
    }

    // Step 6: Load dashboard — a redirect to /login/ means the session is invalid.
    const { text: dashHtml, finalUrl: dashUrl } = await get(
      `${BASE}/client/`,
      jar,
    );
    if (dashUrl.includes("login"))
      throw new Error(`[${TAG}] Not authenticated`);

    // Step 7: Activate the trial if not already active, then extract the M3U link.
    let m3uLink = extractPlaylists(dashHtml)?.tvPlaylist ?? null;
    if (!m3uLink && dashHtml.includes("activate_trial")) {
      const csrf2 = clientCsrf(dashHtml);
      if (!csrf2) throw new Error(`[${TAG}] Dashboard CSRF not found`);
      log(`[${TAG}] Activating trial…`);
      const { text: res } = await post(
        `${BASE}/client/`,
        jar,
        { csrf_token: csrf2, activate_trial: "1" },
        `${BASE}/client/`,
      );
      // Try POST response first; re-fetch if the server redirected away.
      m3uLink =
        extractPlaylists(res)?.tvPlaylist ??
        extractPlaylists((await get(`${BASE}/client/`, jar)).text)
          ?.tvPlaylist ??
        null;
    }

    if (m3uLink) log(`[${TAG}] ✅ M3U: ${m3uLink}`);
    else log(`[${TAG}] M3U not found.`, "warn");

    const creds = extractCredsFromM3u(m3uLink);
    const vod = creds
      ? `https://p.rapidnas.org/vod/${creds.user}/${creds.pass}/a/p.m3u8`
      : null;

    return buildResult({
      username: creds?.user ?? email,
      password: creds?.pass ?? PASSWORD,
      tvPlaylist: m3uLink ?? null,
      vodPlaylist: vod,
      trialHours: 24,
      serviceName: "OgoTV",
    });
  },
};
