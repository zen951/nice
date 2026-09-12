import "./ControlBar.css";

const STATUS_CONFIG = {
  idle: { label: "Idle — Ready", colorClass: "status-idle" },
  running: { label: "Automation Active…", colorClass: "status-running" },
  done: { label: "Completed", colorClass: "status-done" },
  error: { label: "Error Encountered", colorClass: "status-error" },
  cancelled: { label: "Process Cancelled", colorClass: "status-cancelled" },
};

function PlayIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function SquareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </svg>
  );
}

export default function ControlBar({
  status,
  email,
  onStart,
  onStop,
  canStart,
}) {
  const isRunning = status === "running";
  const currentStatus = STATUS_CONFIG[status] || {
    label: status,
    colorClass: "status-idle",
  };

  return (
    <div className="control-card">
      {/* Status indicator bar */}
      <div className={`status-pill-container ${currentStatus.colorClass}`}>
        <div className="status-left">
          <div className="status-dot-indicator" />
          <span className="status-state-text">{currentStatus.label}</span>
        </div>
        {isRunning && <div className="spinner" />}
      </div>

      {/* Active email card */}
      {email && (
        <div className="active-email-card">
          <div className="active-email-content">
            <span>📫</span>
            <span className="active-email-text" title={email}>
              {email}
            </span>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="controls-button-group">
        <button
          id="btn-start"
          className="btn-command btn-command-start"
          onClick={onStart}
          disabled={!canStart || isRunning}
          title={
            !canStart
              ? "Select an email provider and at least 1 service above"
              : "Start automated trial registration"
          }
        >
          {isRunning ? (
            <>
              <div className="spinner" />
              <span>Processing Trials…</span>
            </>
          ) : (
            <>
              <PlayIcon />
              <span>Start Automation</span>
            </>
          )}
        </button>

        {!canStart && !isRunning && (
          <span className="control-hint-text">
            ⚠️ Select target services above to enable
          </span>
        )}

        <button
          id="btn-stop"
          className="btn-command btn-command-stop"
          onClick={onStop}
          disabled={!isRunning}
        >
          <SquareIcon />
          <span>Stop Task</span>
        </button>
      </div>
    </div>
  );
}
