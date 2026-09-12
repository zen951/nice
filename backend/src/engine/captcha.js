/**
 * captcha.js
 *
 * Shared reCAPTCHA challenge helper.
 *
 * Exports:
 *   awaitCaptcha(taskId, emitter, pageUrl, sitekey, log)
 *     — emits a captcha_challenge event and returns a Promise that resolves
 *       with the token when the frontend POSTs the solved response back.
 */
import { emit } from "./events.js";
import { setPendingCaptcha } from "./taskStore.js";

// Emits a captcha_challenge event and returns a Promise that resolves
// when the frontend POSTs the solved reCAPTCHA token back via the captcha route.
export function awaitCaptcha(
  taskId,
  emitter,
  pageUrl,
  sitekey,
  serviceName,
  log,
) {
  log(`[${serviceName}] reCAPTCHA detected — waiting for user to solve…`);
  emit(emitter, "captcha_challenge", {
    taskId,
    sitekey,
    pageUrl,
    serviceName,
  });
  return new Promise((resolve) => setPendingCaptcha(taskId, resolve));
}
