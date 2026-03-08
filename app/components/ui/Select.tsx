'use client';

import React from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  options: SelectOption[];
  onChange?: (value: string) => void;
}

export function Select({ label, options, onChange, style, id, ...props }: SelectProps) {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-');

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xs)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--text-sm)',
    fontWeight: 700,
  };

  const selectStyle: React.CSSProperties = {
    padding: 'var(--space-sm) var(--space-md)',
    fontSize: 'var(--text-base)',
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 'var(--border-radius)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    cursor: 'pointer',
    ...style,
  };

  return (
    <div style={containerStyle}>
      {label && <label htmlFor={selectId} style={labelStyle}>{label}</label>}
      <select
        id={selectId}
        style={selectStyle}
        onChange={(e) => onChange?.(e.target.value)}
        {...props}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
