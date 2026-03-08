'use client';

import React from 'react';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({
  label,
  error,
  style,
  id,
  ...props
}: TextareaProps) {
  const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-');

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xs)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--text-sm)',
    fontWeight: 700,
  };

  const textareaStyle: React.CSSProperties = {
    padding: 'var(--space-sm) var(--space-md)',
    fontSize: 'var(--text-base)',
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 'var(--border-radius)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    outline: 'none',
    resize: 'vertical',
    minHeight: '100px',
    ...style,
  };

  const errorStyle: React.CSSProperties = {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-error)',
  };

  return (
    <div style={containerStyle}>
      {label && <label htmlFor={textareaId} style={labelStyle}>{label}</label>}
      <textarea
        id={textareaId}
        style={textareaStyle}
        {...props}
      />
      {error && <span style={errorStyle}>{error}</span>}
    </div>
  );
}
