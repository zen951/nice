/**
 * generators.js
 *
 * Shared random data generators and date/duration utilities.
 * Used by services and email providers — no domain dependencies.
 *
 * Exports:
 *   generateUsername()         — random lowercase username (10 letters + 10 digits)
 *   generatePassword()         — random mixed-case alphanumeric password (10 chars)
 *   generatePhone()            — random 10-digit phone number (non-zero leading digit)
 *   computeExpiresAt(msOrDate) — formatted expiry timestamp from ms offset or Date
 *   computeTrialExpiry(hours)  — shorthand: computeExpiresAt(hours * 3_600_000)
 *   parseExpiryDate(raw)       — parses "DD.MM.YYYY HH:mm" UTC string into a Date
 *   formatDuration(expiryDate) — remaining time from a Date as "N Hours"
 *   buildResult(fields)        — builds the standardised service result object
 *   TVCORN_ALL_COUNTRIES       — all country codes selected by default in TVCorn's trial UI
 */

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "23456789"; // avoids ambiguous 0/1

// Picks n random characters from charset.
function rand(charset, n) {
  return Array.from(
    { length: n },
    () => charset[Math.floor(Math.random() * charset.length)],
  ).join("");
}

// Returns a random username: 10 lowercase letters followed by 10 digits.
export function generateUsername() {
  return rand(LOWERCASE, 10) + rand(DIGITS, 10);
}

// Returns a random password: 6 mixed-case letters followed by 4 digits.
export function generatePassword() {
  return rand(LOWERCASE + UPPERCASE, 6) + rand(DIGITS, 4);
}

// Returns a random 10-digit phone number with a non-zero leading digit.
export function generatePhone() {
  const lead = String(Math.floor(1 + Math.random() * 9));
  const rest = String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
  return lead + rest;
}

// Returns a human-readable expiry timestamp for the given Date or ms offset.
// Format: "Jan 1, 2026, 00:00" (en-US, 24-hour clock).
export function computeExpiresAt(msOrDate, { timeZone } = {}) {
  const date =
    msOrDate instanceof Date ? msOrDate : new Date(Date.now() + msOrDate);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone && { timeZone }),
  });
}

// Shorthand: converts trial hours to ms offset then formats.
export function computeTrialExpiry(hours) {
  return computeExpiresAt(hours * 3_600_000);
}

// Parses a "DD.MM.YYYY HH:mm" UTC string (as returned by some IPTV APIs) into a Date.
export function parseExpiryDate(raw) {
  if (!raw) return null;
  const [datePart, timePart] = raw.split(" ");
  const [day, month, year] = datePart.split(".");
  return new Date(`${year}-${month}-${day}T${timePart}:00Z`);
}

// Returns the remaining time from an expiry Date as "N Hours".
export function formatDuration(expiryDate) {
  if (!expiryDate) return null;
  const totalHours = Math.round((expiryDate - Date.now()) / 3_600_000);
  return `${totalHours} Hours`;
}

// Builds an Xtream-Codes M3U+ URL from a server host and credentials.
// Returns null if any argument is missing.
export const buildM3u = (host, username, password) =>
  host && username && password
    ? `${host}/get.php?username=${username}&password=${password}&type=m3u_plus&output=ts`
    : null;

// Builds the standardised service result.
// serviceName — auto-note: "<name> trial activated/registered. (duration)"
// trialHours  — auto duration + expiresAt from fixed hours
// expiryDate  — auto duration + expiresAt from a Date (takes priority)
// playlists   — bag from waitForEmailAndExtractPlaylists(), merged as defaults
export function buildResult({
  username = null,
  password = null,
  serviceName,
  tvPlaylist,
  vodPlaylist,
  allM3uLinks,
  trialHours,
  expiryDate,
  duration,
  expiresAt,
  playlists,
  status = "success",
  note,
} = {}) {
  const tv = tvPlaylist ?? playlists?.tvPlaylist ?? null;
  const vod = vodPlaylist ?? playlists?.vodPlaylist ?? null;
  const links = Array.isArray(allM3uLinks)
    ? allM3uLinks
    : playlists?.allM3uLinks?.length
      ? playlists.allM3uLinks
      : [tv, vod].filter(Boolean);

  let dur = duration ?? playlists?.duration ?? null;
  let exp = expiresAt ?? playlists?.expiresAt ?? null;
  if (!dur || !exp) {
    if (expiryDate instanceof Date && !isNaN(expiryDate)) {
      dur ??= formatDuration(expiryDate);
      exp ??= computeExpiresAt(expiryDate, { timeZone: "Asia/Jerusalem" });
    } else if (trialHours) {
      dur ??=
        trialHours % 24 === 0 && trialHours >= 48
          ? `${trialHours / 24} Days`
          : `${trialHours} Hours`;
      exp ??= computeExpiresAt(trialHours * 3_600_000, {
        timeZone: "Asia/Jerusalem",
      });
    }
  }

  const autoNote = serviceName
    ? `${serviceName} trial ${links.length ? "activated successfully" : "registered — M3U link not found"}. (${dur})`
    : "";

  return {
    username,
    password,
    tvPlaylist: tv,
    vodPlaylist: vod,
    allM3uLinks: links,
    duration: dur,
    expiresAt: exp,
    status,
    note: note ?? autoNote,
  };
}

// All country codes selected by default in the TVCorn trial UI.
export const TVCORN_ALL_COUNTRIES = [
  "de",
  "at",
  "ch",
  "tr",
  "al",
  "xk",
  "mk",
  "rs",
  "hr",
  "ba",
  "me",
  "si",
  "bg",
  "ro",
  "gr",
  "it",
  "es",
  "fr",
  "gb",
  "us",
  "ca",
  "mx",
  "nl",
  "be",
  "pt",
  "pl",
  "cz",
  "sk",
  "hu",
  "se",
  "no",
  "dk",
  "fi",
  "ru",
  "ua",
  "ar",
  "in",
  "pk",
  "kr",
  "cn",
  "jp",
  "th",
  "ph",
  "id",
  "br",
  "ar2",
  "co",
  "cl",
  "pe",
  "eg",
  "ng",
  "za",
  "ke",
  "ae",
  "iq",
  "ir",
  "az",
  "ge",
  "world",
];
