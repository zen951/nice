/**
 * RevoIPTV — free 24-hour trial via WPForms scraping.
 *
 * Flow:
 *   1. GET  /free-trial/         → session cookies + WPForms data-token
 *   2. POST /wp-admin/admin-ajax.php (multipart/form-data)
 *   3. Poll inbox → confirm-subscription link → GET it
 *   4. Poll inbox → M3U credentials
 */
import {
  generateUsername,
  generatePhone,
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

const PAGE_URL = "https://revoiptv.com/free-trial/";
const AJAX_URL = "https://revoiptv.com/wp-admin/admin-ajax.php";
const TAG = "RevoIPTV";
const TRIAL_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Builds and submits the WPForms trial form as multipart/form-data.
async function submitForm(jar, token, email) {
  const name = generateUsername();
  const fd = new FormData();

  for (const [k, v] of Object.entries({
    action: "wpforms_submit",
    "wpforms[id]": "28586",
    "wpforms[author]": "0",
    "wpforms[post_id]": "28352",
    "wpforms[token]": token,
    "wpforms[submit]": "wpforms-submit",
    "wpforms[fields][0]": name.slice(0, 5), // First name
    "wpforms[fields][1]": name.slice(5), // Last name
    "wpforms[fields][2]": "United States (US)", // Country
    "wpforms[fields][3]": email, // Email
    "wpforms[fields][4]": generatePhone(), // Phone
    "wpforms[fields][5]": "Other Device", // Device
    "wpforms[fields][6]": "NO", // Adult channels
  }))
    fd.append(k, v);

  const res = await fetch(AJAX_URL, {
    method: "POST",
    headers: {
      "User-Agent": DEFAULT_UA,
      "X-Requested-With": "XMLHttpRequest",
      Origin: "https://revoiptv.com",
      Referer: PAGE_URL,
      Cookie: cookieStr(jar),
    },
    body: fd,
    signal: AbortSignal.timeout(25_000),
  });
  mergeCookies(jar, res);

  // Parse response — reject if WPForms returns an explicit failure.
  const json = JSON.parse(await res.text().catch(() => "{}"));
  if (json?.success === false)
    throw new Error(
      `[${TAG}] Submission rejected: ${JSON.stringify(json?.data?.errors ?? json)}`,
    );
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "revoiptv",
    name: "RevoIPTV",
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

    // Load page to get session cookies and the WPForms anti-replay token.
    const { text: pageHtml } = await get(PAGE_URL, jar);
    const token = /data-token="([^"]+)"/.exec(pageHtml)?.[1];
    if (!token) throw new Error(`[${TAG}] WPForms data-token not found.`);

    await submitForm(jar, token, email.trim());
    log(`[${TAG}] Form submitted.`);

    // Shared options — both poll calls filter by "revo" and skip already-seen emails.
    const seenSet = new Set(inboxSeenIds);
    const pollOpts = { filterText: "revo", seenIds: seenSet };

    // Wait for the double-opt-in confirmation email and click the verify link.
    const confirmLink = await provider.waitForEmailAndExtractLink(
      credentialStore,
      {
        ...pollOpts,
        pattern: /revosub\.com\/confirm-subscription\//,
        timeout: 120_000,
      },
    );
    if (!confirmLink)
      throw new Error(`[${TAG}] Confirmation link not received.`);

    await get(confirmLink, jar);
    log(`[${TAG}] Subscription confirmed.`);

    // After confirmation, the credentials email is sent automatically.
    const playlists = await provider.waitForEmailAndExtractPlaylists(
      credentialStore,
      {
        ...pollOpts,
        timeout: 180_000,
      },
    );

    if (!playlists.allM3uLinks.length)
      log(`[${TAG}] No M3U links found.`, "warn");
    else
      log(
        `[${TAG}] ✅ TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
      );

    return buildResult({
      playlists,
      trialHours: TRIAL_HOURS,
      serviceName: TAG,
    });
  },
};
