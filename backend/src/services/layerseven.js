/**
 * LayerSeven — API-based free trial.
 *
 * Flow:
 *   1. GET /sign-up              → CSRF token
 *   2. Emit captcha_challenge    → await reCAPTCHA token from frontend
 *   3. POST /v1/sign-up/         → register account
 *   4. GET/POST /sign-in         → sign in (may require a second captcha)
 *   5. GET /checkout?free-trial=1 → claim trial
 *   6. Extract credentials from dashboard/accounts/checkout pages
 */
import {
  generatePassword,
  buildM3u,
  buildResult,
} from "../parsing/generators.js";
import { extractCredentials } from "../parsing/extractors.js";
import {
  createJar,
  get,
  post,
  mergeCookies,
  cookieStr,
  errSnippet,
  extractCsrfToken,
  DEFAULT_UA,
} from "../http/cookieClient.js";
import { awaitCaptcha } from "../engine/captcha.js";
// ── Config ────────────────────────────────────────────────────────────────────

const BASE = "https://panel.layerseven.ai";
const M3U_HOST = "http://cf.layersevenw.com";
const SITEKEY = "6Ldwf7wqAAAAANb7Y2mzgutgMalTDWxSf3v0gQQh";
const TAG = "LayerSeven";
const TRIAL_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

// GETs a page to extract its CSRF, waits for the captcha to be solved,
// then POSTs to the corresponding API endpoint with the captcha token.
async function captchaPost(jar, path, extra, taskId, emitter, log) {
  const { text: page } = await get(`${BASE}/${path}`, jar);
  const csrf = extractCsrfToken(page);
  if (!csrf) throw new Error(`[${TAG}] CSRF not found on /${path}`);
  const captcha = await awaitCaptcha(
    taskId,
    emitter,
    `${BASE}/${path}`,
    SITEKEY,
    TAG,
    log,
  );
  return post(
    `${BASE}/v1/${path}/`,
    jar,
    { csrfmiddlewaretoken: csrf, ...extra, "g-recaptcha-response": captcha },
    `${BASE}/${path}`,
  );
}

// ── Steps ─────────────────────────────────────────────────────────────────────

// Registers a new account using the sign-up form + reCAPTCHA.
async function register(jar, email, password, taskId, emitter, log) {
  const { finalUrl, text } = await captchaPost(
    jar,
    "sign-up",
    { email, password },
    taskId,
    emitter,
    log,
  );
  log(`[${TAG}] reCAPTCHA solved — registering…`);
  if (finalUrl.includes("invalid-recaptcha"))
    throw new Error(`[${TAG}] reCAPTCHA rejected — please try again`);
  if (finalUrl.includes("sign-up"))
    throw new Error(`[${TAG}] Registration failed — ${errSnippet(text)}`);
  log(`[${TAG}] ✅ Registered`);
  return text;
}

// Signs in to an existing account.
// A single-hop GET to /sign-in: 302 means already authenticated; 200 requires the form + captcha.
async function signIn(jar, email, password, taskId, emitter, log) {
  const res = await fetch(`${BASE}/sign-in`, {
    headers: {
      "User-Agent": DEFAULT_UA,
      Accept: "text/html",
      Cookie: cookieStr(jar),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(25_000),
  });
  mergeCookies(jar, res);

  if (res.status >= 300 && res.status < 400) {
    log(`[${TAG}] Session valid — skipping sign-in`);
    return;
  }

  const csrf = extractCsrfToken(await res.text());
  if (!csrf) throw new Error(`[${TAG}] CSRF not found on /sign-in`);
  const captcha = await awaitCaptcha(
    taskId,
    emitter,
    `${BASE}/sign-in`,
    SITEKEY,
    TAG,
    log,
  );
  log(`[${TAG}] reCAPTCHA solved — signing in…`);

  const { finalUrl, text } = await post(
    `${BASE}/v1/sign-in/`,
    jar,
    {
      csrfmiddlewaretoken: csrf,
      email,
      password,
      "g-recaptcha-response": captcha,
    },
    `${BASE}/sign-in`,
  );
  if (finalUrl.includes("sign-in") || finalUrl.includes("invalid"))
    throw new Error(`[${TAG}] Sign-in failed — ${errSnippet(text, 100)}`);
  log(`[${TAG}] ✅ Signed in`);
}

// GETs the free-trial checkout page and submits the trial claim form.
async function claimTrial(jar, log) {
  const { text, finalUrl } = await get(`${BASE}/checkout?free-trial=1`, jar);
  if (finalUrl.includes("sign-in"))
    throw new Error(`[${TAG}] Session invalid — redirected to sign-in`);
  const csrf = extractCsrfToken(text);
  // If credentials are already on the page, the trial is already active.
  if (!csrf || extractCredentials(text)) return text;
  log(`[${TAG}] Claiming free trial…`);
  const action = /action="([^"]+)"/.exec(text)?.[1];
  const { text: result } = await post(
    action ? new URL(action, BASE).href : `${BASE}/v1/checkout/`,
    jar,
    { csrfmiddlewaretoken: csrf, "free-trial": "1" },
    `${BASE}/checkout?free-trial=1`,
  );
  log(`[${TAG}] ✅ Trial claimed`);
  return result;
}

// Tries several authenticated pages in sequence until credentials are found.
async function findCredentials(jar, log) {
  for (const path of ["accounts", "dashboard", "checkout?free-trial=1"]) {
    const { text } = await get(`${BASE}/${path}`, jar).catch(() => ({
      text: "",
    }));
    const creds = extractCredentials(text);
    if (creds) {
      log(`[${TAG}] ✅ Credentials found`);
      return creds;
    }
  }
  return null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: {
    id: "layerseven",
    name: "LayerSeven",
    description: `${TRIAL_HOURS} Hours`,
  },

  async execute({ email, taskId, emitter, log = () => {} }) {
    const password = generatePassword();
    const jar = createJar();

    // Step 1–3: Register and check if credentials came back immediately.
    const regHtml = await register(jar, email, password, taskId, emitter, log);
    let creds = extractCredentials(regHtml);

    // If not, sign in and claim the trial explicitly.
    if (!creds) {
      await signIn(jar, email, password, taskId, emitter, log);
      const trialHtml = await claimTrial(jar, log);
      creds =
        extractCredentials(trialHtml) ?? (await findCredentials(jar, log));
    }

    const m3uLink = creds ? buildM3u(M3U_HOST, creds.user, creds.pass) : null;
    if (m3uLink) log(`[${TAG}] ✅ M3U: ${m3uLink}`);

    return buildResult({
      username: creds?.user ?? email,
      password: creds?.pass ?? password,
      tvPlaylist: m3uLink,
      trialHours: TRIAL_HOURS,
      serviceName: "LayerSeven",
    });
  },
};
