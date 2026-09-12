/**
 * CaptchaModal
 *
 * Renders a full-screen overlay with an embedded reCAPTCHA v2 widget when the
 * backend pauses a task and asks the user to solve a captcha.
 *
 * Props:
 *   challenge  { taskId, sitekey, pageUrl } | null  — non-null = show modal
 *   onSolved   (taskId, token) => void              — called after solve + POST
 *   onDismiss  () => void                           — "Cancel" button
 */
import { useEffect, useRef, useState } from "react";
import { submitCaptchaToken } from "../../services/api.js";
import "./CaptchaModal.css";

// reCAPTCHA v2 widget ID assigned by grecaptcha.render() — tracked so we can
// reset it if the modal is shown again for a second captcha in the same task.
let widgetId = null;

export default function CaptchaModal({ challenge, onSolved, onDismiss }) {
  const containerRef = useRef(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Inject the reCAPTCHA script once (idempotent — skips if already loaded).
  useEffect(() => {
    if (document.getElementById("recaptcha-sdk")) return;
    const s = document.createElement("script");
    s.id = "recaptcha-sdk";
    s.src =
      "https://www.google.com/recaptcha/api.js?render=explicit&onload=__rcLoaded";
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }, []);

  // Render (or re-render) the widget each time a new challenge arrives.
  useEffect(() => {
    if (!challenge) return;

    setSubmitting(false);
    setError(null);

    const mount = () => {
      if (!containerRef.current || !window.grecaptcha?.render) return;

      // Reset previous widget if one exists
      if (widgetId !== null) {
        try {
          window.grecaptcha.reset(widgetId);
        } catch (_) {}
        widgetId = null;
      }

      // Clear the container before rendering
      containerRef.current.innerHTML = "";

      widgetId = window.grecaptcha.render(containerRef.current, {
        sitekey: challenge.sitekey,
        theme: "dark",
        callback: async (token) => {
          setSubmitting(true);
          setError(null);
          try {
            await submitCaptchaToken(challenge.taskId, token);
            onSolved?.(challenge.taskId, token);
          } catch (err) {
            setError(`Failed to submit token: ${err.message}`);
            setSubmitting(false);
            if (widgetId !== null) window.grecaptcha?.reset(widgetId);
          }
        },
        "expired-callback": () => {
          setError("Token expired — please solve the captcha again.");
          setSubmitting(false);
        },
        "error-callback": () => {
          setError("reCAPTCHA error — check your connection and try again.");
          setSubmitting(false);
        },
      });
    };

    // If grecaptcha is already available, mount immediately.
    // Otherwise wait for the onload callback.
    if (window.grecaptcha?.render) {
      mount();
    } else {
      window.__rcLoaded = () => {
        mount();
      };
    }
  }, [challenge]);

  if (!challenge) return null;

  return (
    <div
      className="captcha-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Solve CAPTCHA"
    >
      <div className="captcha-modal">
        {/* Header */}
        <div className="captcha-modal-header">
          <div className="captcha-modal-icon">🛡️</div>
          <div>
            <h2 className="captcha-modal-title">Human Verification Required</h2>
            <p className="captcha-modal-sub">
              {challenge.serviceName ?? "This service"} requires a CAPTCHA
              before registering. Solve it below — the automation will resume
              automatically once you're done.
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="captcha-modal-divider" />

        {/* Widget area */}
        <div className="captcha-widget-area">
          <div ref={containerRef} className="captcha-widget-container" />
        </div>

        {/* State feedback */}
        {submitting && (
          <div className="captcha-status submitting">
            <div className="spinner" />
            <span>Submitting token to backend…</span>
          </div>
        )}
        {error && (
          <div className="captcha-status error">
            <span>⚠️ {error}</span>
          </div>
        )}

        {/* Divider */}
        <div className="captcha-modal-divider" />

        {/* Footer */}
        <div className="captcha-modal-footer">
          <p className="captcha-footer-note">
            Task ID:{" "}
            <span className="captcha-task-id">
              {challenge.taskId.slice(0, 8)}…
            </span>
          </p>
          <button
            className="captcha-cancel-btn"
            onClick={onDismiss}
            disabled={submitting}
          >
            Cancel Task
          </button>
        </div>
      </div>
    </div>
  );
}
