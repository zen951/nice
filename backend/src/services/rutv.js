/**
 * RuTV VIP (my.rutv.vip) — API-based free trial registration.
 *
 * Flow:
 *   1. POST /api/auth/register  { username, email, password, language }
 *      → Server sends a verification email.
 *      → Register and Login endpoints skip AES-GCM encryption (confirmed from
 *        bundle — X-Encrypted header is not added for /auth/login or
 *        /auth/register, so plain JSON responses are returned).
 *   2. Poll inbox for the verification link
 *      (https://my.rutv.vip/verify-email?token=<TOKEN>)
 *   3. GET /api/email/verify?token=<TOKEN>  — confirms the account.
 *   4. POST /api/auth/login  { username, password }  → { token, user }
 *   5. GET /api/user/playlist-links (Bearer token, no X-Encrypted header)
 *      → { eu: { main: { longUrl: "..." } }, vod: { longUrl: "..." } }
 *   6. GET /api/user/profile (Bearer token)
 *      → { expirationDate: "ISO string", ... }
 *
 * Notes:
 *   - Disposable/temporary email addresses are blocked (same restriction as
 *     billing.uspeh.my). Use Emailnator dotGmail provider.
 *   - Password requirements: ≥8 chars, ≥1 lowercase, ≥1 uppercase, ≥1 digit.
 *   - Non-auth API responses are AES-GCM encrypted when X-Encrypted is sent.
 *     Omitting that header keeps all responses as plain JSON — we exploit this.
 *   - The fingerprint fields (fp, fp2) added by the browser SPA are optional;
 *     the server accepts registrations without them.
 *   - Trial length (30 days) is shown on the marketing site; the actual expiry
 *     is read back from /user/profile after login.
 */

import { buildResult } from "../parsing/generators.js";
import { DEFAULT_UA } from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://my.rutv.vip";
const API_BASE = `${BASE_URL}/api`;
const TAG = "RuTV";

// Password must have ≥1 lowercase, ≥1 uppercase, ≥1 digit, length ≥8.
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALL = LOWER + UPPER + DIGITS;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick(str) {
  return str[Math.floor(Math.random() * str.length)];
}

// Generates a password that satisfies rutv's complexity rules.
function generateRutvPassword() {
  const base = pick(LOWER) + pick(UPPER) + pick(DIGITS);
  const rest = Array.from({ length: 7 }, () => pick(ALL)).join("");
  return (base + rest)
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

// Generates a username: 8 lowercase letters + 4 digits.
function generateRutvUsername() {
  const letters = Array.from({ length: 8 }, () => pick(LOWER)).join("");
  const digits = Array.from({ length: 4 }, () => pick(DIGITS)).join("");
  return letters + digits;
}

// Human-readable descriptions for known server-side error codes.
const ERROR_MESSAGES = {
  tooManyAttempts:
    "IP rate-limited — too many failed attempts (4 per 24 h). Wait 24 hours before retrying from this IP.",
  temporaryEmailNotAllowed:
    "Disposable/temporary email addresses are blocked. Use a real email provider (e.g. Emailnator dotGmail).",
  emailBlocked:
    "Disposable/temporary email addresses are blocked. Use a real email provider (e.g. Emailnator dotGmail).",
  registrationBlocked:
    "Registration is blocked on the server side. Contact support.",
  userExists: "A user with this username or email already exists.",
  alreadyRegistered: "An account is already registered for this device/IP.",
  serviceUnavailable: "Service temporarily unavailable. Try again later.",
};

// Shared JSON fetch for the rutv API.  Returns parsed JSON or throws.
async function apiFetch(
  path,
  { method = "GET", body = null, token = null } = {},
) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, */*",
    "User-Agent": DEFAULT_UA,
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // Deliberately omit X-Encrypted so the server returns plain JSON.

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (!res.ok) {
    const code = data?.error ?? data?.code ?? null;
    const friendly = code ? ERROR_MESSAGES[code] : null;
    const raw = data?.message ?? `HTTP ${res.status}`;
    throw new Error(`[${TAG}] ${friendly ?? code ?? raw}`);
  }
  return data;
}

// ── Steps ─────────────────────────────────────────────────────────────────────

// Step 1: Register the account.
async function register(username, email, password, log) {
  log(`[${TAG}] Registering account for ${email}…`);
  await apiFetch("/auth/register", {
    method: "POST",
    body: { username, email, password, language: "en" },
  });
  log(
    `[${TAG}] ✅ Registration submitted — check inbox for verification email.`,
  );
}

// Step 2+3: Poll inbox for the verification link and call the verify endpoint.
async function verifyEmail(provider, credentialStore, seenIds, log) {
  log(`[${TAG}] Polling inbox for verification link…`);
  const link = await provider.waitForEmailAndExtractLink(credentialStore, {
    filterText: "rutv",
    pattern: /my\.rutv\.vip.*verify/i,
    seenIds: new Set(seenIds),
    timeout: 120_000,
  });

  if (!link) throw new Error(`[${TAG}] Verification email not received.`);
  log(`[${TAG}] ✅ Verification link received: ${link}`);

  const token = new URL(link).searchParams.get("token");
  if (!token)
    throw new Error(`[${TAG}] Could not extract token from verification link.`);

  log(`[${TAG}] Verifying token…`);
  await apiFetch(`/email/verify?token=${encodeURIComponent(token)}`);
  log(`[${TAG}] ✅ Email verified.`);
}

// Step 4: Login and obtain the JWT.
async function login(username, password, log) {
  log(`[${TAG}] Logging in as ${username}…`);
  const data = await apiFetch("/auth/login", {
    method: "POST",
    body: { username, password },
  });
  const jwt = data?.token ?? data?.data?.token ?? null;
  if (!jwt) throw new Error(`[${TAG}] No token in login response.`);
  log(`[${TAG}] ✅ Logged in — JWT obtained.`);
  return jwt;
}

// Step 5: Fetch M3U playlist links.
async function fetchPlaylistLinks(jwt, log) {
  log(`[${TAG}] Fetching playlist links…`);
  const data = await apiFetch("/user/playlist-links", { token: jwt });

  // Response shape: { eu: { main: { longUrl: "..." }, additional: [...] }, vod: { longUrl: "..." } }
  const tvUrl = data?.eu?.main?.longUrl ?? null;

  // Fallback: walk the additional array for alternate formats.
  let tvFallback = null;
  if (!tvUrl) {
    const additional = data?.eu?.additional ?? [];
    tvFallback = additional.find((e) => e?.longUrl)?.longUrl ?? null;
  }

  const vodUrl = data?.vod?.longUrl ?? null;

  const tvPlaylist = tvUrl ?? tvFallback ?? null;

  if (tvPlaylist) log(`[${TAG}] ✅ TV M3U  : ${tvPlaylist}`);
  else {
    log(
      `[${TAG}] TV M3U not found in playlist-links response. Raw: ${JSON.stringify(data).slice(0, 300)}`,
      "warn",
    );
  }
  if (vodUrl) log(`[${TAG}] ✅ VOD M3U : ${vodUrl}`);

  return { tvPlaylist, vodPlaylist: vodUrl };
}

// Step 6: Fetch profile to get the subscription expiry date.
async function fetchProfile(jwt, log) {
  try {
    log(`[${TAG}] Fetching profile…`);
    const data = await apiFetch("/user/profile", { token: jwt });
    const expiry = data?.expirationDate ?? null;
    if (expiry) log(`[${TAG}] Trial expires: ${expiry}`);
    return expiry;
  } catch (e) {
    log(`[${TAG}] Could not fetch profile (non-fatal): ${e.message}`, "warn");
    return null;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "rutv",
    name: "RuTV VIP",
    description: "30 Days Trial",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const username = generateRutvUsername();
    const password = generateRutvPassword();

    // Step 1: Register.
    await register(username, email, password, log);

    // Step 2+3: Wait for & confirm email verification.
    await verifyEmail(provider, credentialStore, inboxSeenIds, log);

    // Step 4: Login → JWT.
    const jwt = await login(username, password, log);

    // Step 5: Fetch playlist links.
    const { tvPlaylist, vodPlaylist } = await fetchPlaylistLinks(jwt, log);

    // Step 6: Get subscription expiry from profile.
    const expirationDate = await fetchProfile(jwt, log);

    // Parse expiry date if it looks like an ISO string.
    let expiryDate = null;
    if (expirationDate) {
      const parsed = new Date(expirationDate);
      if (!isNaN(parsed.getTime())) expiryDate = parsed;
    }

    return buildResult({
      username,
      password,
      tvPlaylist,
      vodPlaylist,
      expiryDate,
      trialHours: 720,
      serviceName: "RuTV VIP",
    });
  },
};
