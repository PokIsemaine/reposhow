'use client';

import React, { useEffect, useRef } from 'react';

export interface LogEntry {
  time: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  stage?: string;
  message: string;
}

interface LogPanelProps {
  logs: LogEntry[];
  maxHeight?: string;
}

export function LogPanel({ logs, maxHeight = '300px' }: LogPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  const containerStyle: React.CSSProperties = {
    border: 'var(--border-width) solid var(--color-border)',
    background: 'var(--color-bg)',
    maxHeight,
    overflow: 'auto',
    fontSize: 'var(--text-sm)',
  };

  const entryStyle = (level: LogEntry['level']): React.CSSProperties => {
    const base: React.CSSProperties = {
      padding: 'var(--space-xs) var(--space-sm)',
      borderBottom: '1px solid var(--color-bg-alt)',
      fontFamily: 'var(--font-mono)',
    };

    switch (level) {
      case 'ERROR':
        return { ...base, color: 'var(--color-error)', background: '#fff5f5' };
      case 'WARN':
        return { ...base, color: 'var(--color-warning)', background: '#fffbf0' };
      default:
        return base;
    }
  };

  const timestampStyle: React.CSSProperties = {
    color: 'var(--color-text-muted)',
    marginRight: 'var(--space-sm)',
    fontSize: 'var(--text-xs)',
  };

  const levelStyle: React.CSSProperties = {
    display: 'inline-block',
    width: '50px',
    marginRight: 'var(--space-sm)',
    fontWeight: 700,
  };

  const stageStyle: React.CSSProperties = {
    color: 'var(--color-secondary)',
    marginRight: 'var(--space-sm)',
    fontSize: 'var(--text-xs)',
  };

  const copyToClipboard = () => {
    const text = logs.map(l =>
      `[${l.time}] [${l.level}]${l.stage ? ` [${l.stage}]` : ''} ${l.message}`
    ).join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-xs)' }}>
        <button
          onClick={copyToClipboard}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            textDecoration: 'underline',
          }}
        >
          Copy logs
        </button>
      </div>
      <div ref={containerRef} style={containerStyle}>
        {logs.length === 0 ? (
          <div style={{ padding: 'var(--space-md)', color: 'var(--color-text-muted)' }}>
            Waiting for logs...
          </div>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={entryStyle(log.level)}>
              <span style={timestampStyle}>{log.time.split('T')[1]?.split('.')[0]}</span>
              <span style={levelStyle}>{log.level}</span>
              {log.stage && <span style={stageStyle}>[{log.stage}]</span>}
              <span>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
