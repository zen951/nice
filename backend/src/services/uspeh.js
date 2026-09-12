/**
 * USPEH.MY (billing.uspeh.my) — API-based free trial registration.
 *
 * Flow:
 *   1. POST /api/auth/register  { username, email, password, language }
 *      → Server sends a verification email with a click-link.
 *      → Register and Login endpoints are NOT encrypted (confirmed from bundle).
 *   2. Poll inbox for the verification link
 *      (https://billing.uspeh.my/verify-email?token=<TOKEN>)
 *   3. GET /api/email/verify?token=<TOKEN>  — confirms the account.
 *   4. POST /api/auth/login { username, password } → JWT Bearer token.
 *   5. GET /api/user/playlist-links (Bearer token, no X-Encrypted header)
 *      → { eu: { main: { longUrl: "https://..." } } }
 *   6. GET /api/user/profile (Bearer token)
 *      → { expirationDate: "..." }
 *
 * Notes:
 *   - Temporary/disposable email domains are blocked; use @gmail.com addresses
 *     (Emailnator dotGmail provider works fine).
 *   - Password requirements: ≥8 chars, at least one lowercase, one uppercase,
 *     one digit.
 *   - The SPA uses AES-GCM encryption on non-auth API responses when the
 *     X-Encrypted request header is present. Omitting that header keeps all
 *     responses as plain JSON.
 *   - The trial is a free period granted upon email verification — the
 *     expirationDate from /user/profile shows when it ends.
 */

import { buildResult } from "../parsing/generators.js";
import { DEFAULT_UA } from "../http/cookieClient.js";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = "https://billing.uspeh.my";
const API_BASE = `${BASE_URL}/api`;
const TAG = "USPEH";

// Password must have ≥1 lowercase, ≥1 uppercase, ≥1 digit, length ≥8.
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALL = LOWER + UPPER + DIGITS;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick(str) {
  return str[Math.floor(Math.random() * str.length)];
}

// Generates a password that satisfies uspeh's complexity rules.
function generateUspehPassword() {
  const base = pick(LOWER) + pick(UPPER) + pick(DIGITS);
  const rest = Array.from({ length: 7 }, () => pick(ALL)).join("");
  // Shuffle to avoid predictable prefix pattern.
  return (base + rest)
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

// Generates a username: 8 lowercase letters (no digits — cleaner look).
function generateUspehUsername() {
  return (
    Array.from({ length: 8 }, () => pick(LOWER)).join("") +
    Array.from({ length: 4 }, () => pick(DIGITS)).join("")
  );
}

// Known server-side error codes and their human-readable messages.
const ERROR_MESSAGES = {
  tooManyAttempts:
    "IP rate-limited — too many failed attempts (4 per 24 h). Wait 24 hours before retrying from this IP.",
  temporaryEmailNotAllowed:
    "Disposable/temporary email addresses are blocked. Use a real email provider.",
  temporaryEmailBlocked:
    "Disposable/temporary email addresses are blocked. Use a real email provider.",
  emailBlocked: "This email address is blocked by the server.",
  registrationBlocked:
    "Registration is blocked on the server side. Contact support.",
  userExists: "A user with this username or email already exists.",
  alreadyRegistered: "An account is already registered for this device/IP.",
  serviceUnavailable: "Service temporarily unavailable. Try again later.",
};

// Shared JSON fetch for the uspeh API. Returns parsed JSON or throws.
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
  const data = await apiFetch("/auth/register", {
    method: "POST",
    body: { username, email, password, language: "en" },
  });
  log(
    `[${TAG}] ✅ Registration submitted — check inbox for verification email.`,
  );
  return data;
}

// Step 2+3: Poll inbox for the verification link and call the verify endpoint.
async function verifyEmail(provider, credentialStore, seenIds, log) {
  log(`[${TAG}] Polling inbox for verification link…`);
  const link = await provider.waitForEmailAndExtractLink(credentialStore, {
    filterText: "uspeh",
    pattern: /billing\.uspeh\.my.*verify/i,
    seenIds: new Set(seenIds),
    timeout: 120_000,
  });

  if (!link) throw new Error(`[${TAG}] Verification email not received.`);
  log(`[${TAG}] ✅ Verification link received: ${link}`);

  // Extract the token from the link URL.
  const token = new URL(link).searchParams.get("token");
  if (!token)
    throw new Error(`[${TAG}] Could not extract token from verification link.`);

  // Call the server-side verify endpoint directly (no browser needed).
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

// Step 5: Fetch the M3U playlist link.
async function fetchPlaylistLink(jwt, log) {
  log(`[${TAG}] Fetching playlist links…`);
  const data = await apiFetch("/user/playlist-links", { token: jwt });

  // Response shape: { eu: { main: { longUrl: "..." }, additional: [...] } }
  const mainUrl = data?.eu?.main?.longUrl ?? null;

  // Fallback: walk all formats in additional array.
  if (!mainUrl) {
    const additional = data?.eu?.additional ?? [];
    const alt = additional.find((e) => e?.longUrl)?.longUrl ?? null;
    if (alt) {
      log(`[${TAG}] M3U from additional links: ${alt}`);
      return alt;
    }
  }

  if (mainUrl) log(`[${TAG}] ✅ M3U link: ${mainUrl}`);
  else {
    const raw = JSON.stringify(data).slice(0, 300);
    log(
      `[${TAG}] M3U not found in playlist-links response. Raw: ${raw}`,
      "warn",
    );
  }
  return mainUrl;
}

// Step 6: Fetch the profile to get the expiration date.
async function fetchProfile(jwt, log) {
  try {
    log(`[${TAG}] Fetching profile…`);
    const data = await apiFetch("/user/profile", { token: jwt });
    const expiry =
      data?.expirationDate ?? data?.subscription?.expirationDate ?? null;
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
    id: "uspeh",
    name: "USPEH TV",
    description: "Trial Period",
  },

  async execute({
    provider,
    credentialStore,
    email,
    inboxSeenIds = new Set(),
    log = () => {},
  }) {
    const username = generateUspehUsername();
    const password = generateUspehPassword();

    // Step 1: Register.
    await register(username, email, password, log);

    // Step 2+3: Wait for & confirm email verification.
    await verifyEmail(provider, credentialStore, inboxSeenIds, log);

    // Step 4: Login → JWT.
    const jwt = await login(username, password, log);

    // Step 5: Get M3U playlist URL.
    const tvPlaylist = await fetchPlaylistLink(jwt, log);

    // Step 6: Get trial expiry from profile.
    const expirationDate = await fetchProfile(jwt, log);

    // Parse the expiry date if it looks like an ISO string.
    let expiryDate = null;
    if (expirationDate) {
      const parsed = new Date(expirationDate);
      if (!isNaN(parsed.getTime())) expiryDate = parsed;
    }

    return buildResult({
      username,
      password,
      tvPlaylist,
      expiryDate,
      trialHours: 72,
      serviceName: "USPEH TV",
    });
  },
};
