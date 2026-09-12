/**
 * email/base.js
 *
 * Shared infrastructure every disposable email provider is built on.
 *
 * Exports:
 *   makeGetReader(pageKey, tag, buildReader)     — credential guard for polling
 *   createProviderMethods(tag, getReader, opts?) — generates the 3 inbox-polling methods
 *
 * Providers write credentials onto a plain store object in createEmail(),
 * then read them back here when polling starts.
 */

import logger from "../logger.js";
import { pollApi } from "../http/poller.js";
import {
  extractLinks,
  extractPlaylists,
  EMPTY_PLAYLISTS,
} from "../parsing/extractors.js";

// ── Credential helper ─────────────────────────────────────────────────────────

// Returns a getReader function that reads pageKey off the credential store.
// Throws if createEmail() hasn't been called yet for this store.
export function makeGetReader(pageKey, tag, buildReader) {
  return function getReader(store) {
    const credential = store[pageKey];
    if (!credential)
      throw new Error(`[${tag}] No ${pageKey} — call createEmail first.`);
    return buildReader(credential);
  };
}

// ── Provider method factory ───────────────────────────────────────────────────

// Generates the three standard inbox-polling methods for any API-based provider.
export function createProviderMethods(tag, getReader, defaultOpts = {}) {
  // Starts the poll loop, logs the outcome, and returns the result.
  async function _run(store, startMsg, timeoutMsg, opts, onRow) {
    logger.info(`[${tag}] ${startMsg}`);
    const result = await pollApi(
      getReader(store),
      { ...defaultOpts, ...opts },
      onRow,
    );
    if (!result) logger.warn(`[${tag}] ${timeoutMsg}`);
    return result;
  }

  return {
    // Polls until an email containing a 6-digit verification code arrives.
    async waitForVerificationCodeEmail(
      store,
      {
        filterText = "",
        seenIds = new Set(),
        codeRe = /\b(\d{6})\b/,
        timeout = 120_000,
        signal = null,
      } = {},
    ) {
      return _run(
        store,
        "Polling inbox for verification code...",
        "Timed out waiting for verification code.",
        { filterText, seenIds, timeout, signal },
        (content, preview) => {
          // Strip tags so codes inside <b>/<span> are visible to the regex.
          const plain = content
            .replace(/<[^>]*>/g, " ")
            .replace(/\s{2,}/g, " ");
          const code =
            codeRe.exec(preview)?.[1] ?? codeRe.exec(plain)?.[1] ?? null;
          if (code) logger.info(`[${tag}] Code found: ${code}`);
          else
            logger.warn(
              `[${tag}] No code in this email — skipping. preview: ${preview.slice(0, 120)}`,
            );
          return code;
        },
      );
    },

    // Polls until a matching email arrives, then returns the first URL
    // (or the first URL matching pattern when provided).
    async waitForEmailAndExtractLink(
      store,
      {
        filterText = "",
        pattern = null,
        seenIds = new Set(),
        timeout = 120_000,
        signal = null,
      } = {},
    ) {
      const label = filterText ? ` matching "${filterText}"` : "";
      return _run(
        store,
        `Waiting for link email${label}...`,
        `Timed out waiting for email${label}.`,
        { filterText, seenIds, timeout, signal },
        (content, preview) => {
          const links = extractLinks(content);
          const match =
            (pattern ? links.find((l) => pattern.test(l)) : links[0]) ?? null;
          if (match) logger.info(`[${tag}] Extracted link: ${match}`);
          else
            logger.warn(
              `[${tag}] No usable link in email (preview: "${preview.slice(0, 80)}") — skipping.`,
            );
          return match;
        },
      );
    },

    // Polls until an email with M3U playlist links arrives and returns them.
    // Never returns null — callers expect a destructurable object.
    async waitForEmailAndExtractPlaylists(
      store,
      {
        filterText = "",
        seenIds = new Set(),
        timeout = 120_000,
        signal = null,
      } = {},
    ) {
      const label = filterText ? ` matching "${filterText}"` : "";
      const result = await _run(
        store,
        `Polling inbox for playlist email${label}...`,
        "Timed out waiting for playlist email.",
        { filterText, seenIds, timeout, signal },
        (content, preview) => {
          const playlists = extractPlaylists(content);
          if (!playlists) {
            logger.warn(
              `[${tag}] No M3U links in this email — skipping. preview: ${preview.slice(0, 120)}`,
            );
            return null;
          }
          logger.info(
            `[${tag}] TV: ${playlists.tvPlaylist}, VOD: ${playlists.vodPlaylist ?? "none"}, total: ${playlists.allM3uLinks.length}`,
          );
          if (playlists.duration)
            logger.info(
              `[${tag}] Duration: ${playlists.duration}${playlists.expiresAt ? ` · expires: ${playlists.expiresAt}` : ""}`,
            );
          return playlists;
        },
      );
      return result ?? EMPTY_PLAYLISTS;
    },
  };
}
