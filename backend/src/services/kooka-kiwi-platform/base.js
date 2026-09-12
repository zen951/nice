/**
 * kooka-kiwi-platform/base.js
 *
 * Shared registration engine for services running on the Kooka-Kiwi platform (MyKiwiTV & Kooka.TV).
 *
 * Both kooka.tv and mykiwitv.com use the same backend API:
 *   POST <baseUrl>/api/trial/signup  →  { ok, trial: { username, password, ... } }
 *
 * Each service file calls `createKookaKiwiService(config)` and exports the result.
 */

// ─── Imports ─────────────────────────────────────────────────────────────────

import {
  generatePhone,
  generateUsername,
  buildM3u,
  buildResult,
} from "../../parsing/generators.js";
import { jsonPost } from "../../http/cookieClient.js";

// ─── Factory ──────────────────────────────────────────────────────────────────

const DEFAULT_TRIAL_HOURS = 12;

// Builds a reusable service object for any kooka-kiwi-platform provider using the shared signup API (createKookaKiwiService).
export function createKookaKiwiService({
  id,
  name,
  trialHours = DEFAULT_TRIAL_HOURS,
  description = `${trialHours} Hours`,
  baseUrl,
  tag = name,
  buildPayload = () => ({
    email: `${generateUsername()}@gmail.com`,
    whatsappNumber: generatePhone(),
    fpComponents: [],
  }),
}) {
  const signupUrl = `${baseUrl}/api/trial/signup`;

  return {
    meta: { id, name, description },

    // ─── Execute ───────────────────────────────────────────────────────────

    async execute({ email, log = () => {} }) {
      // ─── Signup Request ──────────────────────────────────────────────────

      log(`[${tag}] Submitting trial signup for ${email}...`);
      const data = await jsonPost(signupUrl, null, buildPayload(email), {
        referer: `${baseUrl}/`,
        throwOnError: false,
        timeout: 20_000,
      });

      // Bail out if the API signals a rejected signup
      if (!data?.ok)
        throw new Error(
          `[${tag}] Signup rejected: ${data?.displayMessage ?? data?.reason ?? JSON.stringify(data)}`,
        );

      // ─── Credential Extraction ───────────────────────────────────────────

      // Normalize credential fields across different API response shapes
      const t = data.trial ?? data;
      const username = t.username ?? t.user ?? null;
      const password = t.password ?? t.pass ?? null;
      const expiryDate = t.expiresAt ? new Date(t.expiresAt) : null;

      // ─── M3U Link Construction ───────────────────────────────────────────

      // Build all possible M3U playlist links from the response
      const m3uUrl = t.m3uUrl ?? t.m3u ?? null;
      const primaryM3u = buildM3u(
        t.primaryServer ?? t.server ?? t.host,
        username,
        password,
      );
      const backupM3u = buildM3u(t.secondaryServer, username, password);
      // Deduplicate links and drop any that couldn't be constructed
      const allM3uLinks = [
        ...new Set([backupM3u, primaryM3u, m3uUrl].filter(Boolean)),
      ];

      if (m3uUrl) log(`[${tag}] ✅ M3U URL    : ${m3uUrl}`);
      if (primaryM3u) log(`[${tag}] ✅ M3U primary: ${primaryM3u}`);
      if (backupM3u) log(`[${tag}] ✅ M3U backup : ${backupM3u}`);
      if (!allM3uLinks.length)
        log(`[${tag}] M3U link not found in API response.`, "warn");

      // ─── Result ──────────────────────────────────────────────────────────

      // Package credentials and playlist links into the standard result shape
      return buildResult({
        username,
        password,
        tvPlaylist: allM3uLinks.join("\n") || null,
        allM3uLinks,
        expiryDate,
        trialHours,
        serviceName: name,
      });
    },
  };
}
