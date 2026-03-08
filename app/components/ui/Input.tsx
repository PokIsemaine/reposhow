'use client';

import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({
  label,
  error,
  style,
  id,
  ...props
}: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xs)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--text-sm)',
    fontWeight: 700,
  };

  const inputStyle: React.CSSProperties = {
    padding: 'var(--space-sm) var(--space-md)',
    fontSize: 'var(--text-base)',
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 'var(--border-radius)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    outline: 'none',
    transition: 'box-shadow 0.1s ease',
    ...style,
  };

  const errorStyle: React.CSSProperties = {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-error)',
  };

  return (
    <div style={containerStyle}>
      {label && <label htmlFor={inputId} style={labelStyle}>{label}</label>}
      <input
        id={inputId}
        style={inputStyle}
        {...props}
      />
      {error && <span style={errorStyle}>{error}</span>}
    </div>
  );
}
