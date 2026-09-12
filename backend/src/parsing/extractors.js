/**
 * extractors.js
 *
 * Pure HTML/email content parsers — no side effects, no external dependencies.
 *
 * Exports:
 *   extractLinks(content)          — collects all URLs from href attributes and bare links
 *   extractDuration(content)       — parses a subscription duration and computes expiry
 *   extractPlaylists(content)      — parses M3U links and classifies TV/VOD playlists
 *   extractCredentials(html)       — extracts { user, pass } from page HTML attributes/text
 *   extractCredsFromM3u(m3uUrl)    — extracts { user, pass } from an M3U URL string
 *   EMPTY_PLAYLISTS                — shared empty result for when no playlists are found
 */

import { computeExpiresAt } from "./generators.js";

// ── Duration units ────────────────────────────────────────────────────────────

const DURATION_UNITS = [
  { pattern: /дней|день|дня|days?/i, label: "Days", ms: 864e5 },
  { pattern: /месяцев|месяца|месяц|months?/i, label: "Months", ms: 2592e6 },
  { pattern: /часов|часа|час|hours?/i, label: "Hours", ms: 36e5 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Converts common HTML entities to their plaintext equivalents so URLs
// containing &amp; survive regex matching.
function decodeEntities(str) {
  return str
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

// ── Exports ───────────────────────────────────────────────────────────────────

// Collects all URLs from href attributes and bare links in email content.
export function extractLinks(content) {
  const hrefs = [...content.matchAll(/href=["']([^"']+)["']/gi)].map(
    (m) => m[1],
  );
  const bare = [...content.matchAll(/https?:\/\/[^\s"'<>\]]+/gi)].map(
    (m) => m[0],
  );
  return [...new Set([...hrefs, ...bare])];
}

// Parses a duration string (e.g. "24 Hours", "3 дня") and returns
// a formatted label and an expiry timestamp.
export function extractDuration(content) {
  const m = content.match(
    /(\d+)\s*(дней|день|дня|месяцев|месяца|месяц|часов|часа|час|days?|months?|hours?)/i,
  );
  if (!m) return { duration: null, expiresAt: null };

  const n = parseInt(m[1], 10);
  const unit = DURATION_UNITS.find((u) => u.pattern.test(m[2]));

  return {
    duration: unit
      ? `${n} ${n === 1 ? unit.label.slice(0, -1) : unit.label}`
      : `${n} ${m[2]}`,
    expiresAt: unit
      ? computeExpiresAt(n * unit.ms, { timeZone: "Asia/Jerusalem" })
      : null,
  };
}

// Shared empty result returned when no playlists are found.
export const EMPTY_PLAYLISTS = {
  tvPlaylist: null,
  vodPlaylist: null,
  allM3uLinks: [],
  duration: null,
  expiresAt: null,
};

// Extracts M3U playlist URLs from email content, classifies them into
// TV and VOD, and returns a playlist result. Returns null when none are found.
export function extractPlaylists(content) {
  const d = decodeEntities(content);

  // Matches .m3u/.m3u8 URLs, Xtream-style type=m3u / output=m3u query strings,
  // /playlist/ path URLs, and clipboard-text attribute values containing m3u links.
  const M3U_RE =
    /https?:\/\/[^\s"'<>]*(?:\.m3u8?|[?&](?:type|output)=m3u|\/playlist\/)[^\s"'<>]*/gi;

  const unique = [
    ...new Set([
      ...[...d.matchAll(M3U_RE)].map((m) => m[0]),
      ...[
        ...d.matchAll(
          /href=["']([^"']*(?:\.m3u8?|[?&](?:type|output)=m3u)[^"']*)/gi,
        ),
      ].map((m) => m[1]),
      ...[
        ...d.matchAll(
          /data-clipboard-text=["']([^"']*(?:\.m3u8?|[?&](?:type|output)=m3u|\/playlist\/)[^"']*)/gi,
        ),
      ].map((m) => m[1]),
    ]),
  ].filter((u) => /^https?:\/\//i.test(u));

  if (!unique.length) return null;

  // Prefer live/playlist URLs for TV; prefer /vod/ URLs for VOD.
  const tv =
    unique.find((u) => /type=m3u|\/tv\.|\/playlist|live/i.test(u)) ?? unique[0];
  const vod =
    unique.find((u) => /\/vod\.|type=m3u8/i.test(u) && u !== tv) ??
    unique[1] ??
    null;
  const { duration, expiresAt } = extractDuration(content);

  return {
    tvPlaylist: tv,
    vodPlaylist: vod,
    allM3uLinks: unique,
    duration,
    expiresAt,
  };
}

// Tries multiple regex patterns to extract Xtream or plaintext credentials
// from page HTML (input attributes, data-* attrs, or label: value text).
// Returns { user, pass } or null.
export function extractCredentials(html) {
  if (!html) return null;
  const m =
    /get\.php\?username=([^&"'\s]+)&(?:amp;)?password=([^&"'\s]+)/i.exec(html);
  if (m) return { user: m[1], pass: m[2] };
  const u =
    /data-username="([^"]+)"/i.exec(html)?.[1] ??
    /(?:username|user)[^>]{0,80}value="([^"]+)"/i.exec(html)?.[1] ??
    /(?:username|user)\s*[:-]\s*([A-Za-z0-9_@.+-]+)/i.exec(html)?.[1];
  const p =
    /data-password="([^"]+)"/i.exec(html)?.[1] ??
    /(?:password|passwd|pass)[^>]{0,80}value="([^"]+)"/i.exec(html)?.[1] ??
    /(?:password|passwd|pass)\s*[:-]\s*([A-Za-z0-9_@.+!#$%-]+)/i.exec(
      html,
    )?.[1];
  return u && p ? { user: u, pass: p } : null;
}

// Extracts username and password from an M3U URL string.
// Handles both /playlist/user/pass/ path format and ?username=&password= query format.
// Returns { user, pass } or null.
export const extractCredsFromM3u = (m3uUrl) => {
  if (!m3uUrl) return null;
  const r =
    /\/playlist\/([^/]+)\/([^/]+)\//.exec(m3uUrl) ??
    /username=([^&"'\s]+)&(?:amp;)?password=([^&"'\s]+)/i.exec(m3uUrl);
  return r ? { user: r[1], pass: r[2] } : null;
};
