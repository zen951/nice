import './ProviderSelector.css';

function MailIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function ProviderSelector({ providers, value, onChange }) {
  return (
    <div className="provider-card">
      <div className="provider-label-row">
        <div className="provider-label-title">
          <span className="provider-icon-badge">
            <MailIcon />
          </span>
          <span>Email Provider</span>
        </div>
      </div>

      {providers.length === 0 ? (
        <div className="provider-loading-state">
          <div className="spinner" />
          <span>Fetching temp-mail providers…</span>
        </div>
      ) : (
        <div className="provider-select-box">
          <select
            id="provider-select"
            className="provider-select"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.description ? `— ${p.description}` : ''}
              </option>
            ))}
          </select>
          <div className="provider-arrow-icon">
            <ChevronDownIcon />
          </div>
        </div>
      )}
    </div>
  );
}
