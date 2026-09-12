/**
 * voco-fos-layer-platform/base.js
 *
 * Shared registration engine for services running on the submit-trial REST platform
 * (Fos TV, LayerSeven TV, VocoIPTV, GreatestIPTV, etc.).
 *
 * Flow:
 *   1. POST <apiUrl>  — no captcha, no OTP required.
 *   2. Poll inbox for the welcome email containing M3U credentials.
 *
 * Each service file calls `createSubmitTrialService(config)` and exports the result.
 */

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  generateUsername,
  generatePhone,
  buildResult,
} from "../../parsing/generators.js";
import { jsonPost } from "../../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

// All services on this platform offer a 24-hour free trial by default.
const DEFAULT_TRIAL_HOURS = 24;

// ── Factory ───────────────────────────────────────────────────────────────────

// Builds a service object for any provider using a POST → inbox-poll flow.
//
// Required for the default submit-trial shape:  domain, websiteId
// Optional overrides for services with a different API:
//   apiUrl       — custom POST endpoint (default: https://<domain>/api/submit-trial)
//   referer      — custom Referer header  (default: https://<domain>/free-trial)
//   buildPayload — (email) => payload object (default: standard submit-trial fields)
export function createSubmitTrialService({
  id,
  name,
  domain,
  websiteId,
  filterText = domain?.split(".")?.[0] ?? name.toLowerCase(),
  trialHours = DEFAULT_TRIAL_HOURS,
  timeout = 300_000, // 5-minute inbox polling window
  // ── Optional overrides ────────────────────────────────────────────────────
  apiUrl,
  referer,
  buildPayload,
}) {
  const trialUrl = referer ?? `https://${domain}/free-trial`;
  const resolvedApiUrl = apiUrl ?? `https://${domain}/api/submit-trial`;
  const tag = name;

  // Default payload matches the standard voco-fos-layer submit-trial API shape.
  const resolvedBuildPayload =
    buildPayload ??
    ((email) => ({
      website_id: websiteId,
      website_url: domain,
      customer_name: generateUsername(),
      customer_email: email.trim(),
      customer_phone: generatePhone(),
    }));

  return {
    meta: { id, name, description: `${trialHours} Hours` },

    // Submits the trial form and waits for the credential email.
    async execute({
      provider,
      credentialStore,
      email,
      inboxSeenIds = new Set(),
      log = () => {},
    }) {
      // Step 1: POST trial request — server queues the credential email.
      await jsonPost(resolvedApiUrl, null, resolvedBuildPayload(email), {
        referer: trialUrl,
      });
      log(`[${tag}] Trial request submitted.`);

      // Step 2: Poll inbox until the welcome email with M3U links arrives.
      const playlists = await provider.waitForEmailAndExtractPlaylists(
        credentialStore,
        {
          filterText,
          seenIds: new Set(inboxSeenIds),
          timeout,
        },
      );

      // Step 3: Log outcome and return the standardised result.
      if (!playlists.allM3uLinks.length) {
        log(`[${tag}] No M3U links found in confirmation email.`, "warn");
      } else {
        log(
          `[${tag}] ✅ M3U extracted — TV: ${playlists.tvPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
        );
      }

      return buildResult({
        playlists,
        trialHours,
        serviceName: tag,
      });
    },
  };
}
