/**
 * Y6TV free trial registration service (API-based).
 *
 * Submits registration directly via HTTP POST then polls the inbox
 * for a confirmation email containing M3U playlist links.
 * Trial duration: 3 days (72 hours).
 */
import { buildResult } from "../parsing/generators.js";
import { post, DEFAULT_UA } from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TRIAL_URL = "https://rg.y6tv.me/regfm.php?devTypeID=100";
const TAG = "Y6TV";
const TRIAL_HOURS = 72;

// ── Helpers ───────────────────────────────────────────────────────────────────

// POSTs the registration form and optionally verifies the response script.
async function submitRegistration(email, log) {
  log(`[${TAG}] Submitting registration via API for ${email}...`);

  const { text: html, status } = await post(
    TRIAL_URL,
    null,
    {
      step: "2",
      email,
      isNeedLoginAutogen: "on",
      regBtn: "Зарегистрировать",
    },
    TRIAL_URL,
    { ua: DEFAULT_UA, timeout: 15_000 },
  );

  if (status >= 400)
    throw new Error(`HTTP ${status}: Registration POST failed`);

  // Y6TV injects a verification script into the response; reconstruct its URL
  // from the base src attribute and the addPar query string to check for errors.
  const baseSrcMatch = html.match(
    /setAttribute\s*\(\s*["']src["']\s*,\s*["']([^"']+)["']\s*\+\s*addPar\s*\)/i,
  );
  const addParMatch = html.match(/addPar\s*=\s*['"]([^'"]+)['"]/);

  let scriptUrl =
    baseSrcMatch && addParMatch
      ? baseSrcMatch[1] + addParMatch[1]
      : (html.match(/src\s*=\s*["']([^"']+)["']/i)?.[1] ?? null);

  if (scriptUrl) {
    if (!scriptUrl.startsWith("http")) scriptUrl = `https:${scriptUrl}`;
    try {
      const scriptRes = await fetch(scriptUrl, {
        headers: { "User-Agent": DEFAULT_UA, Referer: "https://rg.y6tv.me/" },
        signal: AbortSignal.timeout(10_000),
      });
      const scriptText = await scriptRes.text();
      const errMatch = scriptText.match(
        /class=['"]regFormErrInf['"][^>]*>([^<]+)/i,
      );
      const msg = errMatch?.[1]?.trim();
      if (msg && !msg.includes("Поздравляем") && !msg.includes("успешно"))
        throw new Error(`Registration rejected: ${msg}`);
    } catch (err) {
      if (err.message?.startsWith("Registration rejected")) throw err;
      log(
        `[${TAG}] Warning: Could not verify response script: ${err.message}`,
        "warn",
      );
    }
  }

  log(`[${TAG}] Registration submitted successfully.`);
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "y6tv",
    name: "Y6TV",
    description: "3 Days",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    // Step 1: Submit registration via API.
    await submitRegistration(email, log);

    // Step 2: Poll inbox for confirmation email with M3U links.
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        filterText: "y6tv",
        seenIds: new Set(inboxSeenIds),
        timeout: 120_000,
      },
    );

    if (!playlists.allM3uLinks.length)
      log(`[${TAG}] No M3U links found in confirmation email.`, "warn");
    else
      log(
        `[${TAG}] ✅ M3U extracted — TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
      );

    return buildResult({
      playlists,
      trialHours: TRIAL_HOURS,
      serviceName: "Y6TV",
    });
  },
};
