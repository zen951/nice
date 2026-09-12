import { useState, useEffect, useRef } from 'react';
import './LogPanel.css';

function TerminalIcon() {
  return (
    <svg className="log-terminal-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function LogEntryRow({ entry }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(entry.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch (_) {}
  };

  return (
    <div
      className={`log-item-row${copied ? ' copied' : ''}`}
      onClick={handleCopy}
      title="Click to copy this line"
    >
      <span className="log-timestamp">{entry.time}</span>
      <span className="log-prompt-char">›</span>
      <span className={`log-message ${entry.level || 'info'}`}>{entry.message}</span>
      <span className="log-copy-indicator">
        {copied ? '✓ Copied' : '⎘'}
      </span>
    </div>
  );
}

export default function LogPanel({ logs }) {
  const bottomRef = useRef(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [filterLevel, setFilterLevel] = useState('all'); // 'all' | 'error' | 'warn'

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleCopyAll = async () => {
    if (!logs.length) return;
    try {
      const text = logs.map((l) => `[${l.time}] ${l.message}`).join('\n');
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch (_) {}
  };

  const filteredLogs = logs.filter((l) => {
    if (filterLevel === 'all') return true;
    return l.level === filterLevel;
  });

  return (
    <div className="log-panel-wrapper">
      <div className="log-panel-header">
        <div className="log-panel-left">
          <div className="terminal-dots">
            <span className="dot-circle dot-red" />
            <span className="dot-circle dot-yellow" />
            <span className="dot-circle dot-green" />
          </div>
          <div className="log-panel-title">
            <TerminalIcon />
            <span>Execution Terminal</span>
          </div>
          <span className="log-count-tag">{logs.length} events</span>
        </div>

        <div className="log-panel-right-controls">
          {/* Quick Level Filter */}
          <div className="log-filter-group">
            <button
              className={`log-filter-btn${filterLevel === 'all' ? ' active' : ''}`}
              onClick={() => setFilterLevel('all')}
            >
              All
            </button>
            <button
              className={`log-filter-btn${filterLevel === 'error' ? ' active' : ''}`}
              onClick={() => setFilterLevel('error')}
            >
              Errors
            </button>
          </div>

          {/* Copy All Logs */}
          <button
            className={`log-tool-btn${copiedAll ? ' copied' : ''}`}
            onClick={handleCopyAll}
            disabled={logs.length === 0}
            title="Copy full terminal history"
          >
            <CopyIcon />
            <span>{copiedAll ? '✓ Copied' : 'Copy All'}</span>
          </button>
        </div>
      </div>

      <div className="log-scroll-area">
        {filteredLogs.length === 0 ? (
          <div className="log-empty-state">
            <span className="log-empty-icon">📟</span>
            <span>{logs.length === 0 ? 'Live automation stream will appear here when task starts…' : 'No logs match the selected filter.'}</span>
          </div>
        ) : (
          filteredLogs.map((entry, i) => (
            <LogEntryRow key={i} entry={entry} />
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
