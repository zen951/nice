import { useState } from "react";
import "./ResultsTable.css";

function TableIcon() {
  return (
    <svg
      className="results-table-icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M9 3v18" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="8" x2="21" y1="6" y2="6" />
      <line x1="8" x2="21" y1="12" y2="12" />
      <line x1="8" x2="21" y1="18" y2="18" />
      <line x1="3" x2="3.01" y1="6" y2="6" />
      <line x1="3" x2="3.01" y1="12" y2="12" />
      <line x1="3" x2="3.01" y1="18" y2="18" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function StatusPill({ status }) {
  const map = {
    success: { cls: "pill-success", label: "✓ Success" },
    failed: { cls: "pill-failed", label: "✕ Failed" },
    captcha: { cls: "pill-captcha", label: "🛡 CAPTCHA" },
  };
  const { cls, label } = map[status] || {
    cls: "pill-pending",
    label: status || "pending",
  };
  return <span className={`status-badge ${cls}`}>{label}</span>;
}

function CopyCell({ value, placeholder = "—" }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (_) {}
  };

  return (
    <div className="copy-wrapper">
      <span className="copy-text-truncated" title={value}>
        {value || placeholder}
      </span>
      {value && (
        <button
          className={`copy-action-btn${copied ? " copied" : ""}`}
          onClick={handleCopy}
          title="Copy to clipboard"
        >
          {copied ? "✓ Copied" : "⎘ Copy"}
        </button>
      )}
    </div>
  );
}

function cleanM3uUrl(rawUrl) {
  if (!rawUrl) return null;
  return rawUrl
    .replace(/&lt;.*$/i, "")
    .replace(/&gt;.*$/i, "")
    .replace(/<.*$/i, "")
    .replace(/&amp;/g, "&")
    .replace(/[\s"'<>]+.*$/, "")
    .replace(/[;,.)\\]+$/, "")
    .trim();
}

function SinglePlaylistUrl({ url, type }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (_) {}
  };

  return (
    <div className="playlist-cell-wrapper">
      <span className={`playlist-url-tag type-${type}`} title={url}>
        {url}
      </span>
      <button
        className={`copy-action-btn${copied ? " copied" : ""}`}
        onClick={handleCopy}
        title="Copy playlist URL"
      >
        {copied ? "✓" : "⎘"}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="playlist-external-link"
        title="Open link in new tab"
      >
        ↗
      </a>
    </div>
  );
}

function PlaylistCell({ url: rawUrl, type = "tv" }) {
  // Support multiple URLs separated by newlines (e.g. kooka backup + built M3U)
  const urls = (rawUrl ?? "").split("\n").map(cleanM3uUrl).filter(Boolean);

  if (!urls.length) {
    if (type === "vod") {
      return (
        <span
          className="playlist-none-badge vod-none"
          title="No VOD playlist provided by this service"
        >
          <span className="none-symbol">🚫</span>
          <span className="none-text">No VOD Playlist</span>
        </span>
      );
    }
    return (
      <span className="playlist-waiting-text" title="Waiting for playlist">
        <span className="waiting-symbol">⏳</span>
        <span>Waiting…</span>
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {urls.map((url, i) => (
        <SinglePlaylistUrl key={i} url={url} type={type} />
      ))}
    </div>
  );
}

export default function ResultsTable({ results }) {
  const [viewMode, setViewMode] = useState("table"); // 'table' | 'grid'
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedAll, setCopiedAll] = useState(false);

  // Extract all non-null playlist links
  const allLinks = results
    .flatMap((r) => [cleanM3uUrl(r.tvPlaylist), cleanM3uUrl(r.vodPlaylist)])
    .filter(Boolean);

  const handleCopyAll = async () => {
    if (!allLinks.length) return;
    try {
      await navigator.clipboard.writeText(allLinks.join("\n"));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1600);
    } catch (_) {}
  };

  const handleDownloadM3U = () => {
    if (!allLinks.length) return;
    let m3uContent = "#EXTM3U\n\n";
    results.forEach((r) => {
      const tv = cleanM3uUrl(r.tvPlaylist);
      const vod = cleanM3uUrl(r.vodPlaylist);
      if (tv) {
        m3uContent += `#EXTINF:-1 tvg-id="${r.serviceId || "iptv"}" group-title="Live TV", [${r.service}] Live TV\n${tv}\n\n`;
      }
      if (vod) {
        m3uContent += `#EXTINF:-1 tvg-id="${r.serviceId || "iptv"}" group-title="VOD Movies", [${r.service}] VOD Library\n${vod}\n\n`;
      }
    });

    const blob = new Blob([m3uContent], { type: "audio/x-mpegurl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `iptv-harvested-${Date.now()}.m3u`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredResults = results.filter((r) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      r.service?.toLowerCase().includes(query) ||
      r.email?.toLowerCase().includes(query) ||
      r.tvPlaylist?.toLowerCase().includes(query) ||
      r.vodPlaylist?.toLowerCase().includes(query) ||
      r.status?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="results-panel-wrapper">
      <div className="results-panel-header">
        <div className="results-header-left">
          <div className="results-panel-title">
            <TableIcon />
            <span>Harvested Playlists & Subscriptions</span>
          </div>
          <span className="results-badge-count">{results.length} records</span>
        </div>

        <div className="results-header-actions">
          {/* Quick Search Bar */}
          {results.length > 0 && (
            <div className="results-search-box">
              <SearchIcon />
              <input
                type="text"
                className="results-search-input"
                placeholder="Search results…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}

          {/* Export & Download Tools */}
          <button
            className={`action-tool-btn${copiedAll ? " copied" : ""}`}
            onClick={handleCopyAll}
            disabled={allLinks.length === 0}
            title="Copy all harvested playlist URLs to clipboard"
          >
            <span>{copiedAll ? "✓ All Copied!" : "⎘ Copy All M3U"}</span>
          </button>

          <button
            className="action-tool-btn"
            onClick={handleDownloadM3U}
            disabled={allLinks.length === 0}
            title="Download formatted .m3u playlist file"
          >
            <DownloadIcon />
            <span>Export .m3u</span>
          </button>

          {/* View toggle switch */}
          <div className="view-toggle-group">
            <button
              className={`view-toggle-btn${viewMode === "table" ? " active" : ""}`}
              onClick={() => setViewMode("table")}
              title="Table View"
            >
              <ListIcon />
              <span>Table</span>
            </button>
            <button
              className={`view-toggle-btn${viewMode === "grid" ? " active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="Grid Card View"
            >
              <GridIcon />
              <span>Cards</span>
            </button>
          </div>
        </div>
      </div>

      <div className="results-table-scroll">
        {results.length === 0 ? (
          <div className="results-empty-state">
            <div className="results-empty-icon-wrap">
              <span>📡</span>
            </div>
            <div className="results-empty-title">
              No playlists harvested yet
            </div>
            <p className="results-empty-desc">
              Select your email provider and target services, then click{" "}
              <strong>Start Automation</strong> to capture Live TV and VOD
              playlists automatically.
            </p>
          </div>
        ) : filteredResults.length === 0 ? (
          <div className="results-empty-state">
            <div className="results-empty-title">
              No results matching "{searchQuery}"
            </div>
            <p className="results-empty-desc">
              Try searching for a different keyword or clear the search field.
            </p>
          </div>
        ) : viewMode === "table" ? (
          /* ── Table View ─────────────────────────────────────────────── */
          <table className="iptv-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Email</th>
                <th>Duration / Expiry</th>
                <th>Live TV (tv.m3u)</th>
                <th>VOD (vod.m3u)</th>
                <th>Status</th>
                <th>Notes</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.map((r, i) => (
                <tr key={i}>
                  <td className="service-name-cell">{r.service}</td>
                  <td>
                    <CopyCell value={r.email} />
                  </td>
                  <td>
                    {r.duration ? (
                      <div className="duration-expiry-stack">
                        <span className="duration-chip">⏳ {r.duration}</span>
                        {r.expiresAt && (
                          <span
                            className="expiry-time-text"
                            title={`Exact Expiration: ${r.expiresAt}`}
                          >
                            📅 {r.expiresAt}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="empty-dash-text">—</span>
                    )}
                  </td>
                  <td>
                    <PlaylistCell url={r.tvPlaylist} type="tv" />
                  </td>
                  <td>
                    <PlaylistCell url={r.vodPlaylist} type="vod" />
                  </td>
                  <td>
                    <StatusPill status={r.status} />
                  </td>
                  <td className="note-text-cell" title={r.error || r.note}>
                    {r.error || r.note || "—"}
                  </td>
                  <td className="time-text-cell">
                    {r.timestamp
                      ? new Date(r.timestamp).toLocaleTimeString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /* ── Grid Card View ─────────────────────────────────────────── */
          <div className="results-card-grid">
            {filteredResults.map((r, i) => (
              <div key={i} className="playlist-card-item">
                <div className="card-top-row">
                  <div className="card-service-title">
                    <span>📺</span>
                    <span>{r.service}</span>
                  </div>
                  <StatusPill status={r.status} />
                </div>

                <div className="card-email-badge">
                  <span>📫 {r.email}</span>
                  <CopyCell value={r.email} />
                </div>

                {r.duration && (
                  <div className="duration-expiry-stack">
                    <span className="duration-chip">⏳ {r.duration}</span>
                    {r.expiresAt && (
                      <span className="expiry-time-text">
                        📅 Expires: {r.expiresAt}
                      </span>
                    )}
                  </div>
                )}

                <div className="card-m3u-box">
                  <div className="card-m3u-row">
                    <span className="card-m3u-type-tag tv">TV M3U</span>
                    <span
                      className="card-m3u-link-preview"
                      title={r.tvPlaylist}
                    >
                      {cleanM3uUrl(r.tvPlaylist) ||
                        "Waiting for confirmation email…"}
                    </span>
                    {r.tvPlaylist && (
                      <PlaylistCell url={r.tvPlaylist} type="tv" />
                    )}
                  </div>

                  <div className="card-m3u-row">
                    <span className="card-m3u-type-tag vod">VOD M3U</span>
                    {r.vodPlaylist ? (
                      <>
                        <span
                          className="card-m3u-link-preview"
                          title={r.vodPlaylist}
                        >
                          {cleanM3uUrl(r.vodPlaylist)}
                        </span>
                        <PlaylistCell
                          url={r.vodPlaylist}
                          type="vod"
                          status={r.status}
                        />
                      </>
                    ) : (
                      <span
                        className="playlist-none-badge vod-none"
                        title="No VOD playlist provided by this service"
                      >
                        <span className="none-symbol">🚫</span>
                        <span className="none-text">No VOD Playlist</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="card-bottom-row">
                  <span>{r.note || r.error || "Ready"}</span>
                  <span>
                    {r.timestamp
                      ? new Date(r.timestamp).toLocaleTimeString()
                      : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
