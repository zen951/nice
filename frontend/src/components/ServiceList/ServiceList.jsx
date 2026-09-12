import './ServiceList.css';

function RadioTowerIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
      <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default function ServiceList({ services, selected, onToggle, disabled }) {
  const handleSelectAll = () => {
    services.forEach((s) => {
      if (!selected.includes(s.id)) onToggle(s.id);
    });
  };

  const handleClearAll = () => {
    selected.forEach((id) => onToggle(id));
  };

  return (
    <div className="service-card">
      <div className="service-card-header">
        <div className="service-label-title">
          <span className="service-icon-badge">
            <RadioTowerIcon />
          </span>
          <span>Target Services</span>
        </div>
        
        {services.length > 0 && (
          <div className="service-header-controls">
            <button
              className="service-quick-btn"
              onClick={handleSelectAll}
              disabled={disabled || selected.length === services.length}
              title="Select all services"
            >
              All
            </button>
            <button
              className="service-quick-btn"
              onClick={handleClearAll}
              disabled={disabled || selected.length === 0}
              title="Deselect all"
            >
              None
            </button>
            <span className={`service-count-chip${selected.length === 0 ? ' empty' : ''}`}>
              {selected.length}/{services.length}
            </span>
          </div>
        )}
      </div>

      {services.length === 0 ? (
        <div className="service-loading-state">
          <div className="spinner" />
          <span>Discovering registered services…</span>
        </div>
      ) : (
        <>
          <div className="service-list-box">
            {services.map((svc) => {
              const isSelected = selected.includes(svc.id);
              return (
                <label
                  key={svc.id}
                  className={`service-item-row${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                >
                  <input
                    type="checkbox"
                    id={`service-${svc.id}`}
                    className="service-checkbox-input"
                    checked={isSelected}
                    disabled={disabled}
                    onChange={() => onToggle(svc.id)}
                  />
                  <div className="service-checkbox-visual">
                    {isSelected && <CheckIcon />}
                  </div>
                  <div className="service-meta-group">
                    <div className="service-name-text">{svc.name}</div>
                    {svc.url && (
                      <div className="service-url-subtext">
                        {svc.url.replace(/^https?:\/\//, '')}
                      </div>
                    )}
                  </div>
                  <span className="service-type-badge">
                    {svc.description ? svc.description.split(' ').slice(0, 2).join(' ') : 'IPTV'}
                  </span>
                </label>
              );
            })}
          </div>

          {selected.length === 0 && (
            <div className="service-empty-warning">
              <span>⚠️ Select at least 1 service to begin</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
