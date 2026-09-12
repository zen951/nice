/**
 * LibertyTV (account.libertytv.net) — free 24-hour IPTV trial.
 *
 * Registers and verifies the account server-side, then logs in, claims the
 * trial, and scrapes the M3U playlist link from the dashboard.
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
  errSnippet,
} from "../http/cookieClient.js";

const BASE_URL = "https://account.libertytv.net";
const DASHBOARD_URL = `${BASE_URL}/dashboard.php`;
const TAG = "LibertyTV";
const TRIAL_HOURS = 24;
const REGISTRATION_LIMIT_MESSAGE =
  "Too many registration attempts from your network. Please try again in an hour.";

function getRegistrationCsrf(html) {
  return (
    extractInputValue(html, "csrf") ??
    html.match(
      /<input\b[^>]*\bname=["']csrf["'][^>]*\bvalue=["']([^"']+)["']/i,
    )?.[1] ??
    html.match(
      /<input\b[^>]*\bvalue=["']([^"']+)["'][^>]*\bname=["']csrf["']/i,
    )?.[1] ??
    null
  );
}

function isRegistrationLimitPage(html) {
  return /Too many registration attempts from your network\.\s*Please try again in an hour\./i.test(
    html,
  );
}

function isCloudflareChallenge(html) {
  return /(?:Just a moment|cf-chl-|challenge-platform|Cloudflare)/i.test(
    html,
  );
}

async function registerAccount({ jar, name, email, password, log }) {
  const {
    text: registerPage,
    status: registerStatus,
    finalUrl: registerUrl,
  } = await get(`${BASE_URL}/register.php`, jar);
  if (isRegistrationLimitPage(registerPage)) {
    log(`[${TAG}] ${REGISTRATION_LIMIT_MESSAGE}`, "warn");
    throw new Error(`[${TAG}] ${REGISTRATION_LIMIT_MESSAGE}`);
  }

  const csrf = getRegistrationCsrf(registerPage);
  if (!csrf) {
    if (registerStatus === 403) {
      if (isCloudflareChallenge(registerPage)) {
        throw new Error(
          `[${TAG}] LibertyTV returned a Cloudflare challenge (HTTP 403). ` +
            `Vercel cannot complete this browser verification.`,
        );
      }
      throw new Error(
        `[${TAG}] LibertyTV denied the Vercel request (HTTP 403). ` +
          `The registration form is blocked for this deployment's server IP.` +
          ` ${errSnippet(registerPage, 180)}`,
      );
    }
    throw new Error(
      `[${TAG}] Registration form unavailable (HTTP ${registerStatus}, ${registerUrl}).`,
    );
  }

  const response = await post(
    `${BASE_URL}/register.php`,
    jar,
    {
      csrf,
      ref: "",
      tz_detected: Intl.DateTimeFormat().resolvedOptions().timeZone,
      name,
      email,
      password,
    },
    `${BASE_URL}/register.php`,
  );

  if (isRegistrationLimitPage(response.text)) {
    log(`[${TAG}] ${REGISTRATION_LIMIT_MESSAGE}`, "warn");
    throw new Error(`[${TAG}] ${REGISTRATION_LIMIT_MESSAGE}`);
  }

  if (response.status < 200 || response.status >= 400) {
    throw new Error(
      `[${TAG}] Registration request failed with HTTP ${response.status}.`,
    );
  }

  log(`[${TAG}] Registration submitted; waiting for verification code...`);
  return response.finalUrl;
}

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
    log = () => {},
  }) {
    const username = generateUsername();
    const password = generatePassword();
    const jar = createJar();
    const verificationUrl = await registerAccount({
      jar,
      name: username,
      email,
      password,
      log,
    });

    const code = await provider.waitForVerificationCodeEmail(credentialStore, {
      filterText: "liberty",
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
      codeRe:
        /(?:code|verification|confirm(?:ation)?|otp)[^0-9]{0,60}(\d{6})(?!\d)/i,
    });
    if (!code) throw new Error(`[${TAG}] Verification code was not received.`);

    const { text: verificationPage } = await get(verificationUrl, jar);
    await post(
      verificationUrl,
      jar,
      {
        csrf: getRegistrationCsrf(verificationPage) || "",
        code,
        verification_code: code,
        otp: code,
        email,
      },
      verificationUrl,
    );
    log(`[${TAG}] Registration verified - logging in to harvest trial...`);

    let loggedIn = false;
    let m3uLink = null;
    try {
      const { text: loginPage } = await get(`${BASE_URL}/login.php`, jar);
      await post(
        `${BASE_URL}/login.php`,
        jar,
        { csrf: extractInputValue(loginPage, "csrf") || "", email, password },
        `${BASE_URL}/login.php`,
      );
      loggedIn = true;

      let { text: dash } = await get(DASHBOARD_URL, jar);
      const csrf = extractInputValue(dash, "csrf");
      if (
        csrf &&
        (dash.includes("claim-trial") || dash.includes("trial-region"))
      ) {
        log(`[${TAG}] Claiming trial...`);
        await post(
          `${BASE_URL}/claim-trial.php`,
          jar,
          { csrf, region_id: "32", "trial-submit": "1" },
          DASHBOARD_URL,
        );
        dash = (await get(DASHBOARD_URL, jar)).text;
      }

      let playlists = extractPlaylists(dash);
      if (!playlists?.tvPlaylist) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        playlists = extractPlaylists((await get(DASHBOARD_URL, jar)).text);
      }

      m3uLink = playlists?.tvPlaylist ?? null;
      log(
        m3uLink
          ? `[${TAG}] M3U: ${m3uLink}`
          : `[${TAG}] M3U link not found on dashboard.`,
        m3uLink ? "info" : "warn",
      );
    } finally {
      if (loggedIn) {
        try {
          log(`[${TAG}] Logging out...`);
          await get(`${BASE_URL}/logout.php`, jar, { referer: DASHBOARD_URL });
          log(`[${TAG}] Logged out.`);
        } catch (err) {
          log(`[${TAG}] Logout notice: ${err.message}`, "warn");
        }
      }
    }

    return buildResult({
      username,
      password,
      tvPlaylist: m3uLink,
      trialHours: TRIAL_HOURS,
      serviceName: "LibertyTV",
    });
  },
};
