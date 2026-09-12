/**
 * ManualRegisterModal
 *
 * A generic manual-registration overlay used by services that require the user
 * to complete a sign-up form by hand (e.g. TVBoom, LibertyTV).
 *
 * The component receives a `challenge` object from the backend that contains
 * the pre-generated credentials (username, email, password) and, optionally,
 * a verification code or a direct registration URL.  The user copies the
 * credentials into the embedded iframe, finishes the CAPTCHA / email-confirm
 * step, and clicks "Done".  Cancelling signals the backend to abort the task.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { signalManualDone, signalManualCancel } from "../../services/api.js";
import "./ManualRegisterModal.css";

export default function ManualRegisterModal({ challenge, onDone, onDismiss }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);
  const copyTimerRef = useRef(null);

  // Reset local state whenever a new challenge arrives.
  useEffect(() => {
    if (!challenge) return;
    setSubmitting(false);
    setError(null);
    setCopied(null);
  }, [challenge?.taskId]);

  // Clean up the copy-feedback timer on unmount.
  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  /** Copy a credential value to the clipboard and show brief feedback. */
  const copy = useCallback((field, val) => {
    navigator.clipboard.writeText(val).then(() => {
      setCopied(field);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(null), 1800);
    });
  }, []);

  // Derive display properties from the challenge payload.
  const isLiberty = challenge?.serviceId === "libertytv";
  const serviceName =
    challenge?.serviceName || (isLiberty ? "LibertyTV" : "TVBoom");
  const icon = challenge?.icon || (isLiberty ? "🗽" : "📺");

  /** Signal the backend that the user completed the registration form. */
  const handleDone = useCallback(async () => {
    if (!challenge) return;
    setSubmitting(true);
    setError(null);
    try {
      await signalManualDone(challenge.taskId, challenge.serviceId || "tvboom");
      onDone?.(challenge);
    } catch (err) {
      setError(`Failed: ${err.message}`);
      setSubmitting(false);
    }
  }, [challenge, onDone]);

  /** Signal the backend that the user cancelled, then dismiss the modal. */
  const handleCancel = useCallback(async () => {
    if (!challenge) return;
    signalManualCancel(challenge.taskId, challenge.serviceId || "tvboom").catch(
      () => {},
    );
    onDismiss?.(challenge);
  }, [challenge, onDismiss]);

  if (!challenge) return null;

  const { username, password, email, taskId, code, registrationUrl } =
    challenge;

  // Fallback srcDoc for services that don't provide a direct registration URL.
  const tosSrc = `<!DOCTYPE html><html><body style="margin:0;background:#fff;"><form id="f" method="post" action="https://tvboom.vip/register"><input type="hidden" name="do" value="register"><input type="hidden" name="dle_rules_accept" value="yes"></form><script>document.getElementById('f').submit();</script></body></html>`;

  /** Fields to display and copy in the credentials panel. */
  const fields = [
    {
      label: isLiberty ? "Full Name" : "Username",
      val: username,
      key: "username",
    },
    { label: "Email", val: email, key: "email" },
    { label: "Password", val: password, key: "password" },
    ...(code
      ? [
          {
            label: "Verification Code",
            val: code,
            key: "code",
            highlight: true,
          },
        ]
      : []),
  ];

  return (
    <div
      className="tvboom-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${serviceName} Manual Registration`}
    >
      <div className="tvboom-shell">
        {/* ── Left sidebar: credentials + instructions ─────────────────── */}
        <aside className="tvboom-sidebar">
          <div className="tvboom-sidebar-header">
            <span className="tvboom-modal-icon">{icon}</span>
            <div>
              <h2 className="tvboom-modal-title">{serviceName} Registration</h2>
              <p className="tvboom-modal-sub">
                {isLiberty
                  ? "Credentials provided below. Complete registration and click Done."
                  : "Fill in credentials, solve CAPTCHA, then click Done."}
              </p>
            </div>
          </div>

          <div className="tvboom-modal-divider" />

          {/* Credential rows with one-click copy */}
          <div className="tvboom-credentials">
            <p className="tvboom-creds-label">Use in the registration form:</p>
            {fields.map(({ label, val, key, highlight }) => (
              <div
                key={key}
                className={`tvboom-cred-row ${highlight ? "highlighted" : ""}`}
              >
                <span className="tvboom-cred-label">{label}</span>
                <code className="tvboom-cred-value">{val}</code>
                <button
                  type="button"
                  className={`tvboom-copy-btn ${copied === key ? "copied" : ""}`}
                  onClick={() => copy(key, val)}
                  aria-label={`Copy ${label}`}
                >
                  {copied === key ? "✓" : "Copy"}
                </button>
              </div>
            ))}
          </div>

          <div className="tvboom-modal-divider" />

          {/* Step-by-step instructions tailored to each service */}
          <ol className="tvboom-steps">
            {isLiberty ? (
              <>
                <li>Credentials are pre-filled on the right.</li>
                <li>
                  Click <strong>Create account</strong>.
                </li>
                <li>Enter the 6-digit code shown above.</li>
              </>
            ) : (
              <>
                <li>Copy and paste credentials into form.</li>
                <li>Solve the reCAPTCHA on the page.</li>
              </>
            )}
            <li>
              Click <strong>Done</strong> below when finished.
            </li>
          </ol>

          <div className="tvboom-sidebar-spacer" />

          {/* Status feedback */}
          {submitting && (
            <div className="tvboom-status submitting">
              <div className="spinner" />
              <span>Confirming…</span>
            </div>
          )}
          {error && (
            <div className="tvboom-status error">
              <span>⚠️ {error}</span>
            </div>
          )}

          <div className="tvboom-modal-divider" />

          {/* Footer: task ID + action buttons */}
          <div className="tvboom-modal-footer">
            <p className="tvboom-footer-note">
              Task:{" "}
              <span className="tvboom-task-id">{taskId.slice(0, 8)}…</span>
            </p>
            <div className="tvboom-footer-actions">
              <button
                type="button"
                className="tvboom-cancel-btn"
                onClick={handleCancel}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="tvboom-done-btn"
                onClick={handleDone}
                disabled={submitting}
              >
                {submitting ? "Confirming…" : "✓ Done"}
              </button>
            </div>
          </div>
        </aside>

        {/* ── Right panel: embedded registration page ───────────────────── */}
        <iframe
          className="tvboom-iframe"
          src={registrationUrl || undefined}
          srcDoc={registrationUrl ? undefined : tosSrc}
          title={`${serviceName} Registration`}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
        />
      </div>
    </div>
  );
}
