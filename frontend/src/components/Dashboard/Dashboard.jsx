import { useAutomation } from "../../hooks/useAutomation.js";
import ProviderSelector from "../ProviderSelector/ProviderSelector.jsx";
import ServiceList from "../ServiceList/ServiceList.jsx";
import ControlBar from "../ControlBar/ControlBar.jsx";
import LogPanel from "../LogPanel/LogPanel.jsx";
import ResultsTable from "../ResultsTable/ResultsTable.jsx";
import CaptchaModal from "../CaptchaModal/CaptchaModal.jsx";
import ManualRegisterModal from "../ManualRegisterModal/ManualRegisterModal.jsx";
import "./Dashboard.css";

export default function Dashboard() {
  const {
    providers,
    services,
    selectedProvider,
    setSelectedProvider,
    selectedServices,
    toggleService,
    status,
    logs,
    results,
    email,
    backendError,
    captchaChallenge,
    onCaptchaSolved,
    onCaptchaDismiss,
    tvboomRegisterChallenge,
    onTvboomRegisterDone,
    onTvboomRegisterDismiss,
    start,
    stop,
  } = useAutomation();

  const canStart = selectedProvider && selectedServices.length > 0;
  const isRunning = status === "running";

  return (
    <>
      <div className="app-shell">
        {/* ── Topbar ──────────────────────────────────────────────────────── */}
        <header className="topbar">
          <div className="topbar-brand">
            <div className="topbar-logo-mark">
              <span className="topbar-live-dot" />
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <div className="topbar-title-group">
              <h1 className="topbar-title">IPTV Claim Trails</h1>
              <span className="topbar-subtitle">
                Automated Trial Registration & M3U Harvester
              </span>
            </div>
          </div>

          <div className="topbar-meta">
            {results.length > 0 && (
              <div className="topbar-badge active">
                <span>📺 {results.length} Harvested</span>
              </div>
            )}
            <div className="topbar-badge">
              <span>📡 {selectedServices.length} Selected</span>
            </div>
            <div className={`topbar-badge ${isRunning ? "active" : ""}`}>
              {isRunning && <div className="spinner" />}
              <span>{isRunning ? "Running" : "Ready"}</span>
            </div>
          </div>
        </header>

        {/* ── Backend Error Alert ─────────────────────────────────────────── */}
        {backendError && (
          <div className="backend-error-banner">
            <span>
              ⚠️ {backendError} — ensure the backend is running at{" "}
              <strong>http://localhost:3001</strong>
            </span>
          </div>
        )}

        {/* ── Main Workspace ──────────────────────────────────────────────── */}
        <div className="main-content">
          {/* ── Left Sidebar ──────────────────────────────────────────────── */}
          <aside className="sidebar">
            <ProviderSelector
              providers={providers}
              value={selectedProvider}
              onChange={setSelectedProvider}
            />

            <ServiceList
              services={services}
              selected={selectedServices}
              onToggle={toggleService}
              disabled={isRunning}
            />

            <ControlBar
              status={status}
              email={email}
              onStart={start}
              onStop={stop}
              canStart={canStart}
            />
          </aside>

          {/* ── Right Content Area ────────────────────────────────────────── */}
          <main className="right-panel">
            <LogPanel logs={logs} />
            <ResultsTable results={results} />
          </main>
        </div>
      </div>

      {/* ── Captcha Modal (shown when a service needs human verification) ── */}
      <CaptchaModal
        challenge={captchaChallenge}
        onSolved={onCaptchaSolved}
        onDismiss={onCaptchaDismiss}
      />

      {/* ── Manual Registration Modal (TVBoom, LibertyTV, …) ── */}
      <ManualRegisterModal
        challenge={tvboomRegisterChallenge}
        onDone={onTvboomRegisterDone}
        onDismiss={onTvboomRegisterDismiss}
      />
    </>
  );
}
