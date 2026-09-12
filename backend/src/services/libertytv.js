/**
 * LibertyTV (account.libertytv.net) — free 24-hour IPTV trial.
 *
 * Flow:
 *   1. Emit a `libertytv_register` challenge → frontend opens iframe modal with pre-filled creds.
 *   2. Concurrently poll inbox for the 6-digit OTP → forward to frontend via `libertytv_code`.
 *   3. Block until the user clicks Done (or Cancel) in the modal.
 *   4. Log in, claim the trial, scrape the M3U playlist link from the dashboard.
 *   5. Log out to close the session, then return the harvested result.
 */
import {
  generateUsername,
  generatePassword,
  buildResult,
} from "../parsing/generators.js";
import { extractPlaylists } from "../parsing/extractors.js";
import {
  createJar,
  get,
  post,
  extractInputValue,
} from "../http/cookieClient.js";
import { emit } from "../engine/events.js";
import { setPendingManualDone } from "../engine/taskStore.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://account.libertytv.net";
const DASHBOARD_URL = `${BASE_URL}/dashboard.php`;
const TAG = "LibertyTV"; // Log prefix
const TRIAL_HOURS = 24;

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "libertytv",
    name: "LibertyTV (Gmails)",
    description: `${TRIAL_HOURS} Hours`,
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    taskId,
    emitter,
    log = () => {},
  }) {
    const username = generateUsername();
    const password = generatePassword();
    const jar = createJar();
    const codeAbort = new AbortController(); // Aborted once the user confirms or cancels

    // ── Step 1: Open registration modal ───────────────────────────────────────
    // Proxy URL pre-fills credentials and strips X-Frame-Options so the iframe loads cleanly.
    log(`[${TAG}] Waiting for user to complete registration…`);
    emit(emitter, "libertytv_register", {
      taskId,
      serviceId: "libertytv",
      serviceName: "LibertyTV",
      username,
      password,
      email,
      registrationUrl: `/api/automation/libertytv-proxy/register.php?name=${encodeURIComponent(username)}&email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
    });

    // ── Step 2: OTP listener (background, concurrent with user filling the form) ─
    provider
      .waitForVerificationCodeEmail(credentialStore, {
        filterText: "liberty",
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
        signal: codeAbort.signal,
      })
      .then((code) => {
        if (code) {
          log(`[${TAG}] ✅ Verification code: ${code}`);
          emit(emitter, "libertytv_code", { taskId, code });
        }
      })
      .catch(() => {}); // Swallow AbortError when codeAbort fires

    // ── Step 3: Wait for user confirmation (/libertytv-done or /libertytv-cancel) ─
    try {
      await new Promise((res, rej) => setPendingManualDone(taskId, res, rej));
    } finally {
      codeAbort.abort();
    }
    log(`[${TAG}] ✅ Confirmed — logging in to harvest trial…`);

    // ── Step 4: Login, claim trial & scrape M3U ───────────────────────────────

    let loggedIn = false; // Only attempt logout if login succeeded
    let m3uLink = null;
    try {
      // GET login page for CSRF token, then POST credentials.
      const { text: loginPage } = await get(`${BASE_URL}/login.php`, jar);
      await post(
        `${BASE_URL}/login.php`,
        jar,
        { csrf: extractInputValue(loginPage, "csrf") || "", email, password },
        `${BASE_URL}/login.php`,
      );
      loggedIn = true;

      // Claim trial if not yet claimed (dashboard shows claim-trial / trial-region element).
      let { text: dash } = await get(DASHBOARD_URL, jar);
      const csrf = extractInputValue(dash, "csrf");
      if (
        csrf &&
        (dash.includes("claim-trial") || dash.includes("trial-region"))
      ) {
        log(`[${TAG}] Claiming trial…`);
        await post(
          `${BASE_URL}/claim-trial.php`,
          jar,
          { csrf, region_id: "32", "trial-submit": "1" },
          DASHBOARD_URL,
        );
        dash = (await get(DASHBOARD_URL, jar)).text;
      }

      // Retry once after 3 s — dashboard sometimes takes a moment to show the link.
      let playlists = extractPlaylists(dash);
      if (!playlists?.tvPlaylist) {
        await new Promise((r) => setTimeout(r, 3_000));
        playlists = extractPlaylists((await get(DASHBOARD_URL, jar)).text);
      }

      m3uLink = playlists?.tvPlaylist ?? null;
      log(
        m3uLink
          ? `[${TAG}] ✅ M3U: ${m3uLink}`
          : `[${TAG}] M3U link not found on dashboard.`,
        m3uLink ? "info" : "warn",
      );
    } finally {
      // ── Step 5: Logout (always runs, even if harvesting failed) ────────────
      if (loggedIn) {
        try {
          log(`[${TAG}] Logging out…`);
          await get(`${BASE_URL}/logout.php`, jar, { referer: DASHBOARD_URL });
          log(`[${TAG}] ✅ Logged out.`);
        } catch (err) {
          log(`[${TAG}] Logout notice: ${err.message}`, "warn");
        }
      }
    }

    return buildResult({
      username,
      password,
      tvPlaylist: m3uLink,
      trialHours: 24,
      serviceName: "LibertyTV",
    });
  },
};
