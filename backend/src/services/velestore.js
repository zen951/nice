/**
 * VeleStore (velestore.su) — free IPTV trial via registration.
 *
 * Flow:
 *   1. GET /?do=register  — solve AES-128-CBC DDoS challenge (GET cookie).
 *   2. POST /?do=register (dummy) — solve POST-specific DDoS challenge cookie.
 *   3. POST /?do=register — real registration with reCAPTCHA token.
 *   4. GET /index.php?do=test — activates the 3-day trial (mirrors button click).
 *   5. GET /user/<username>/ — scrape the M3U playlist URLs.
 *
 * reCAPTCHA v2 sitekey: 6LdxN2ElAAAAADqK4-H-y-EB7bcoqFjxDtZy7RFa
 */
import { createDecipheriv } from "crypto";
import { runInNewContext } from "vm";
import {
  generateUsername,
  generatePassword,
  buildResult,
} from "../parsing/generators.js";
import { extractPlaylists } from "../parsing/extractors.js";
import {
  createJar,
  mergeCookies,
  cookieStr,
  get,
  request,
  DEFAULT_UA,
} from "../http/cookieClient.js";
import { awaitCaptcha } from "../engine/captcha.js";

const BASE_URL = "https://velestore.su";
const REG_URL = `${BASE_URL}/?do=register`;
const TEST_URL = `${BASE_URL}/index.php?do=test`;
const TAG = "VeleStore";
const TRIAL_HOURS = 72;
const SITEKEY = "6LdxN2ElAAAAADqK4-H-y-EB7bcoqFjxDtZy7RFa";
const OPTS = { referer: REG_URL, origin: BASE_URL };

// ── DDoS solver ───────────────────────────────────────────────────────────────

// Executes the challenge <script> in a VM sandbox instead of parsing it.
// Immune to obfuscation rotations — works regardless of how KEY/IV are encoded.
function injectSolvedCookie(html, jar) {
  const re = /<script[^>]*>\s*([\s\S]*?)\s*<\/script>/gi;
  let m, challengeScript;
  while ((m = re.exec(html))) {
    if (/slowAES/i.test(m[1])) {
      challengeScript = m[1];
      break;
    }
  }
  if (!challengeScript) return false;

  let solvedName, solvedValue;

  // slowAES.decrypt returns a sentinel with the pre-computed hex so the
  // patched toHex wrapper can return it directly, bypassing the cross-realm
  // Array constructor check in the challenge's own toHex implementation.
  const slowAES = {
    decrypt(c3Arr, _mode, keyArr, ivArr) {
      const dec = createDecipheriv(
        "aes-128-cbc",
        Buffer.from(keyArr.map(Number)),
        Buffer.from(ivArr.map(Number)),
      );
      dec.setAutoPadding(false);
      const out = Buffer.concat([
        dec.update(Buffer.from(c3Arr.map(Number))),
        dec.final(),
      ]);
      return { _hex: out.toString("hex"), _isResult: true };
    },
  };

  // Prepend a toHex shim so our sentinel is handled before the challenge's
  // own toHex tries to iterate the byte array.
  const patchedScript = `
    var __origToHex = toHex;
    toHex = function() {
      var a = arguments[0];
      if (a && a._isResult) return a._hex;
      return __origToHex.apply(this, arguments);
    };
    ${challengeScript}
  `;

  const sandbox = {
    slowAES,
    atob: (b64) => Buffer.from(b64, "base64").toString("utf8"),
    document: {
      set cookie(raw) {
        const [pair] = raw.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) {
          solvedName = pair.slice(0, eq).trim();
          solvedValue = pair.slice(eq + 1).trim();
        }
      },
    },
    location: { href: "" },
  };

  try {
    runInNewContext(patchedScript, sandbox, { timeout: 2000 });
  } catch {
    return false;
  }

  if (!solvedName || !solvedValue) return false;
  jar[solvedName] = solvedValue;
  return true;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

// No-redirect POST — captures the DDoS challenge cookie set on POST responses.
async function rawPost(jar, body) {
  const res = await fetch(REG_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": DEFAULT_UA,
      Cookie: cookieStr(jar),
      Origin: BASE_URL,
      Referer: REG_URL,
    },
    body: new URLSearchParams(body).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(25_000),
  });
  mergeCookies(jar, res);
  return { text: await res.text(), status: res.status };
}

// Redirect-following fetch that auto-solves any DDoS challenge and retries.
async function fetch$(method, url, jar, body) {
  for (let i = 0; i < 4; i++) {
    const { text, status } = await request(method, url, jar, { body, ...OPTS });
    if (!injectSolvedCookie(text, jar)) return { text, status };
  }
  throw new Error(`[${TAG}] DDoS challenge not resolved after 4 attempts.`);
}

// ── Steps ─────────────────────────────────────────────────────────────────────

const DUMMY_BODY = {
  name: "x",
  password1: "x",
  password2: "x",
  email: "x@x.x",
  submit_reg: "submit_reg",
  do: "register",
  "g-recaptcha-response": "dummy",
};

// Primes GET and POST DDoS cookies. GET fires first; dummy POST captures any
// POST-specific challenge and confirms it, unless the server already redirects.
async function primeDDosCookies(jar, log) {
  log(`[${TAG}] Priming DDoS cookies...`);
  await fetch$("GET", REG_URL, jar, null);

  const { text, status } = await rawPost(jar, DUMMY_BODY);
  log(`[${TAG}] Dummy POST status: ${status}`);

  if (status >= 300 && status < 400) {
    log(`[${TAG}] POST challenge already satisfied.`);
  } else if (injectSolvedCookie(text, jar)) {
    log(`[${TAG}] POST DDoS solved, confirming...`);
    const { status: s2 } = await rawPost(jar, DUMMY_BODY);
    log(`[${TAG}] Confirmation POST status: ${s2}`);
  } else {
    log(`[${TAG}] No POST challenge found — proceeding.`);
  }

  log(`[${TAG}] DDoS cookies ready: ${Object.keys(jar).join(", ")}`);
}

// Submits the registration form and throws on DLE CMS errors.
async function register(jar, { username, password, email }, captchaToken, log) {
  log(`[${TAG}] Registering ${username}...`);
  const { text } = await fetch$("POST", REG_URL, jar, {
    name: username,
    password1: password,
    password2: password,
    email,
    submit_reg: "submit_reg",
    do: "register",
    "g-recaptcha-response": captchaToken,
  });

  const err = /class="inform-1">([\s\S]{0,400}?)<\/span>/i
    .exec(text)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (err && !/успешно|success/i.test(err))
    throw new Error(`[${TAG}] Registration error: ${err}`);
  if (/уже (зарег|существует)|already (exist|reg)/i.test(text))
    throw new Error(`[${TAG}] Username or email already registered.`);

  log(`[${TAG}] Registration submitted.`);
}

// Activates the trial then scrapes the M3U URL from the profile page.
async function activateAndGetM3u(jar, username, log) {
  log(`[${TAG}] Activating trial...`);
  await get(TEST_URL, jar, OPTS);

  log(`[${TAG}] Fetching profile page...`);
  const { text, status } = await fetch$(
    "GET",
    `${BASE_URL}/user/${encodeURIComponent(username)}/`,
    jar,
    null,
  );
  log(`[${TAG}] Profile page status: ${status}`);

  if (!/Привет[,\s]/i.test(text) && !/playlist\.m3u/i.test(text)) {
    log(
      `[${TAG}] Not authenticated. Jar: ${Object.keys(jar).join(", ")}`,
      "warn",
    );
    return null;
  }

  // Primary: velestore-specific play path pattern.
  const direct =
    /https?:\/\/[^\s"'<>]+\/(?:play(?:18)?|no)\/[^\s"'<>]+\.m3u8?/i.exec(text);
  if (direct) return direct[0];

  // Fallback: shared extractor.
  return extractPlaylists(text)?.tvPlaylist ?? null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export default {
  meta: { id: "velestore", name: "VeleStore", description: "3 Days" },

  async execute({ email, taskId, emitter, log = () => {} }) {
    const username = generateUsername();
    const password = generatePassword();
    const jar = createJar();

    await primeDDosCookies(jar, log);

    const captchaToken = await awaitCaptcha(
      taskId,
      emitter,
      REG_URL,
      SITEKEY,
      TAG,
      log,
    );
    log(`[${TAG}] reCAPTCHA solved — registering...`);

    await register(jar, { username, password, email }, captchaToken, log);

    const cookieKeys = Object.keys(jar);
    log(
      `[${TAG}] Cookies after registration: ${cookieKeys.join(", ") || "(none)"}`,
    );

    // DLE CMS sets PHPSESSID, dle_user_id, dle_password, or similar on successful login.
    const session = cookieKeys.find((k) =>
      /phpsessid|dle_user|user_hash|sess|sid|auth/i.test(k),
    );
    if (!session)
      throw new Error(
        `[${TAG}] No session cookie — captcha may have been rejected.`,
      );
    log(`[${TAG}] Session via ${session}.`);

    const tvPlaylist = await activateAndGetM3u(jar, username, log);
    if (tvPlaylist) log(`[${TAG}] M3U: ${tvPlaylist}`);

    return buildResult({
      username,
      password,
      tvPlaylist,
      trialHours: TRIAL_HOURS,
      serviceName: "VeleStore",
    });
  },
};
