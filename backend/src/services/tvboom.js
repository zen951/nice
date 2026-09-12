/**
 * TVBoom (tvboom.vip) — free 24-hour IPTV trial.
 *
 * Flow (after user fills the iframe and clicks Done):
 *   1. Poll inbox → extract DLE validation link.
 *   2. GET validation link → scrape & follow the step=2 link.
 *   3. GET /main, GET /index.php?do=test (activates trial), GET /main again.
 *   4. Parse `playlistUrl` JS variable → return M3U link.
 */
import {
  generateUsername,
  generatePassword,
  buildResult,
} from "../parsing/generators.js";
import { createJar, get } from "../http/cookieClient.js";
import { emit } from "../engine/events.js";
import { setPendingTvboomDone } from "../engine/taskStore.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = "https://tvboom.vip";
const TAG = "TVBoom";
const TRIAL_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

// GETs the validation link then scrapes and follows the step=2 continuation link.
async function confirmEmail(jar, link, log) {
  const { text } = await get(link, jar);
  const m = /href=["']([^"']*do=register[^"']*step=2[^"']*)/i.exec(text);
  if (!m) {
    log(`[${TAG}] Step-2 link not found — may already be confirmed.`, "warn");
    return;
  }
  const step2 = m[1].startsWith("http")
    ? m[1]
    : new URL(m[1].replace(/&amp;/gi, "&"), BASE).href;
  log(`[${TAG}] ✅ Following step-2: ${step2}`);
  await get(step2, jar);
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: { id: "tvboom", name: "TVBoom", description: `${TRIAL_HOURS} Hours` },

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

    // Step 1: Wait for the user to complete the iframe registration and click Done.
    log(`[${TAG}] Waiting for user to complete registration…`);
    emit(emitter, "tvboom_register", { taskId, username, password, email });
    await new Promise((resolve, reject) =>
      setPendingTvboomDone(taskId, resolve, reject),
    );
    log(`[${TAG}] ✅ Registration confirmed — proceeding…`);

    // Step 2: Poll inbox for the DLE validation link, then confirm the email.
    log(`[${TAG}] Polling inbox for verification email…`);
    const link = await provider.waitForEmailAndExtractLink(credentialStore, {
      filterText: "tvboom",
      pattern: /tvboom\.vip.*doaction=validating/i,
      seenIds: new Set(inboxSeenIds),
      timeout: 120_000,
    });
    if (!link) throw new Error(`[${TAG}] Verification email not received.`);
    log(`[${TAG}] ✅ Verification link: ${link}`);
    await confirmEmail(jar, link, log);

    // Step 3: Enter the dashboard and activate the 24-hour trial.
    await get(`${BASE}/main`, jar);
    await get(`${BASE}/index.php?do=test`, jar, { referer: `${BASE}/main` });
    log(`[${TAG}] ✅ Trial activated.`);

    // Step 4: Fetch /main and parse the M3U URL from the inline JS playlistUrl variable.
    // Template: https://tvboom.vip/{user}/{pass}/%type/playlist.m3u8 → %type = 'hls'.
    const { text } = await get(`${BASE}/main`, jar);
    const mu = /const\s+playlistUrl\s*=\s*['"]([^'"]+)['"]/i.exec(text);
    const tvPlaylist = mu
      ? mu[1].replace("%type", "hls")
      : (/href=["']([^"']*\.m3u8[^"']*)['"]/i.exec(text)?.[1] ?? null);

    if (tvPlaylist) log(`[${TAG}] ✅ M3U: ${tvPlaylist}`);
    return buildResult({
      username,
      password,
      tvPlaylist,
      trialHours: TRIAL_HOURS,
      serviceName: "TVBoom",
    });
  },
};
