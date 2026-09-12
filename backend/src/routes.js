/**
 * Automation API routes — mounted at /api/automation.
 *
 * Endpoints:
 *   GET  /info              – lists available providers and services
 *   POST /start             – creates and starts an automation task
 *   POST /stop/:taskId      – cancels a running task
 *   GET  /stream/:taskId    – streams live task events via SSE
 *   GET  /results/:taskId   – returns final status and results
 */
import { Router } from "express";
import { emailProviders, registrationServices } from "./engine/registry.js";
import {
  createTask,
  getTask,
  cancelTask,
  resolvePendingCaptcha,
  resolvePendingManualDone,
  rejectPendingManualDone,
} from "./engine/taskStore.js";
import { DEFAULT_UA } from "./http/cookieClient.js";
import { runTask } from "./engine/runner.js";
import logger from "./logger.js";

const router = Router();

// ── Info ─────────────────────────────────────────────────────────────────────
// Returns available providers and services so the UI can populate its selectors.

router.get("/info", (_req, res) => {
  res.json({
    providers: emailProviders.map((p) => p.meta),
    services: registrationServices.map((s) => s.meta),
  });
});

// ── Start task ───────────────────────────────────────────────────────────────
// Body: { providerId: string, serviceIds: string[] }
// Creates a task and fires it off asynchronously — the client tracks progress via SSE.

router.post("/start", async (req, res) => {
  const { providerId, serviceIds } = req.body;

  if (!providerId || !Array.isArray(serviceIds) || !serviceIds.length) {
    return res
      .status(400)
      .json({ error: "`providerId` and `serviceIds[]` are required." });
  }

  const { taskId } = createTask();
  logger.info(`[Route] Starting task ${taskId}`);

  // Run without awaiting so the taskId can be returned immediately
  runTask(taskId, providerId, serviceIds).catch((err) =>
    logger.error(`[Route] Unhandled task error: ${err.message}`),
  );

  res.json({ taskId });
});

// ── Stop task ────────────────────────────────────────────────────────────────

router.post("/stop/:taskId", async (req, res) => {
  await cancelTask(req.params.taskId);
  res.json({ ok: true });
});

// ── Stream (SSE) ─────────────────────────────────────────────────────────────
// Streams live task events to the client using Server-Sent Events.

router.get("/stream/:taskId", (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });

  // SSE requires these headers; X-Accel-Buffering disables Nginx proxy buffering
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Keep the connection alive through idle periods
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 20000);

  const sendEvent = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  const onDone = () => {
    clearInterval(keepAlive);
    res.write(`data: ${JSON.stringify({ type: "stream_end" })}\n\n`);
    res.end();
  };

  task.emitter.on("event", sendEvent);
  task.emitter.once("done", onDone);

  // Clean up listeners if the client disconnects before the task finishes
  req.on("close", () => {
    clearInterval(keepAlive);
    task.emitter.off("event", sendEvent);
    task.emitter.off("done", onDone);
  });
});

// ── Captcha relay ─────────────────────────────────────────────────────────────
// The frontend solves the reCAPTCHA widget and POSTs the token here.
// Body: { token: string }

router.post("/captcha/:taskId", (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "`token` is required." });

  const ok = resolvePendingCaptcha(req.params.taskId, token);
  if (!ok)
    return res.status(404).json({ error: "No captcha pending for this task." });

  res.json({ ok: true });
});

// ── Manual registration relays (ManualRegisterModal — TVBoom, LibertyTV, …) ──────────────────

router.post(["/tvboom-done/:taskId", "/libertytv-done/:taskId"], (req, res) =>
  resolvePendingManualDone(req.params.taskId)
    ? res.json({ ok: true })
    : res.status(404).json({ error: "No registration pending." }),
);

router.post(
  ["/tvboom-cancel/:taskId", "/libertytv-cancel/:taskId"],
  (req, res) =>
    rejectPendingManualDone(
      req.params.taskId,
      req.path.includes("liberty") ? "LibertyTV" : "TVBoom",
    )
      ? res.json({ ok: true })
      : res.status(404).json({ error: "No registration pending." }),
);

// ── LibertyTV reverse proxy ───────────────────────────────────────────────────
// Proxies account.libertytv.net inside an iframe without X-Frame-Options/CSP blocks.

router.all("/libertytv-proxy*", async (req, res) => {
  try {
    const rawPath = (req.params[0] || "").replace(/^\//, "") || "register.php";
    const qs = req.url.includes("?") ? `?${req.url.split("?")[1]}` : "";
    const targetUrl = `https://account.libertytv.net/${rawPath}${qs}`;

    const headers = {
      "User-Agent": DEFAULT_UA,
      Accept: req.headers.accept || "*/*",
      "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9",
      ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
    };

    let body;
    if (
      ["POST", "PUT", "PATCH"].includes(req.method) &&
      req.body &&
      Object.keys(req.body).length
    ) {
      const isJson = req.headers["content-type"]?.includes("application/json");
      headers["Content-Type"] = isJson
        ? "application/json"
        : "application/x-www-form-urlencoded";
      body = isJson
        ? JSON.stringify(req.body)
        : new URLSearchParams(req.body).toString();
    }

    // Clear any browser-proxy session before opening a new registration.
    // Without this, LibertyTV can redirect a later registration attempt to
    // the dashboard from the previous account.
    if (req.method === "GET" && rawPath === "register.php") {
      await fetch(`${targetUrl.replace("/register.php", "/logout.php")}`, {
        method: "GET",
        headers,
        redirect: "manual",
      });
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });

    // Rewrite and forward Set-Cookie
    for (const sc of upstream.headers.getSetCookie?.() || []) {
      res.append(
        "Set-Cookie",
        sc
          .replace(/Domain=[^;]+;?/gi, "")
          .replace(/Secure;?/gi, "")
          .replace(/Path=[^;]+;?/gi, "Path=/api/automation/libertytv-proxy;"),
      );
    }

    // Strip frame-blocking headers & rewrite Location
    const BLOCKED_HEADERS = [
      "x-frame-options",
      "content-security-policy",
      "content-security-policy-report-only",
      "content-length",
      "content-encoding",
      "transfer-encoding",
      "set-cookie",
    ];
    upstream.headers.forEach((val, key) => {
      const k = key.toLowerCase();
      if (BLOCKED_HEADERS.includes(k)) return;
      if (k === "location") {
        const loc = val.replace(
          "https://account.libertytv.net/",
          "/api/automation/libertytv-proxy/",
        );
        return res.setHeader(
          "location",
          loc.startsWith("/") ? `/api/automation/libertytv-proxy${loc}` : loc,
        );
      }
      res.setHeader(key, val);
    });

    res.status(upstream.status);
    const contentType = upstream.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      let html = await upstream.text();
      const autofill = `<script>
window.addEventListener('DOMContentLoaded',()=>{try{
  const p=new URLSearchParams(location.search);
  let filled=0;
  for(const f of ['name','email','password']){const v=p.get(f),el=document.querySelector(\`input[name="\${f}"]\`);if(v&&el&&!el.value){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));filled++;}}
  if(filled>0&&location.pathname.includes('register')){
    const btn=document.querySelector('button[type="submit"]');
    if(btn){setTimeout(()=>btn.click(),400);}
  }

  // The parent modal receives the OTP asynchronously. Since this iframe is
  // served from the same origin, copy that value into LibertyTV's verification
  // field when the registration response displays it.
  let verificationSubmitted=false;
  const fillVerificationCode=()=>{
    try{
      const value=window.parent.document
        .querySelector('.tvboom-cred-row.highlighted .tvboom-cred-value')
        ?.textContent?.trim();
      if(!value||!/^\\d{6}$/.test(value))return;
      const field=document.querySelector(
        'input[name="code"],input[name="verification_code"],input[name="verification-code"],input[name="otp"],input[autocomplete="one-time-code"],input[placeholder*="verification" i],input[placeholder*="code" i]'
      );
      if(field&&field.value!==value){
        field.value=value;
        field.dispatchEvent(new Event('input',{bubbles:true}));
        field.dispatchEvent(new Event('change',{bubbles:true}));
      }
      if(!verificationSubmitted){
        const verifyButton=[...document.querySelectorAll('button[type="submit"]')]
          .find((button)=>button.textContent.trim().toLowerCase().includes('verify and continue'));
        if(verifyButton){
          verificationSubmitted=true;
          setTimeout(()=>verifyButton.click(),400);
        }
      }
    }catch(_){}
  };
  fillVerificationCode();
  new MutationObserver(fillVerificationCode).observe(document.body,{childList:true,subtree:true});
  setInterval(fillVerificationCode,500);
}catch(_){}});
</script>`;
      html = html
        .replace(
          "<head>",
          `<head><base href="/api/automation/libertytv-proxy/">`,
        )
        .replace("</head>", `${autofill}</head>`);
      return res.send(html);
    }

    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    logger.error(`[LibertyTV Proxy] ${err.message}`);
    res.status(500).send(`Proxy error: ${err.message}`);
  }
});

// ── Results ───────────────────────────────────────────────────────────────────

router.get("/results/:taskId", (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json({ status: task.status, results: task.results });
});

export default router;
