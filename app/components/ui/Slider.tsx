'use client';

import React from 'react';

interface SliderProps {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}

export function Slider({ label, min = 0, max = 100, step = 1, value, onChange }: SliderProps) {
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xs)',
  };

  const labelContainerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 'var(--text-sm)',
    fontWeight: 700,
  };

  const sliderStyle: React.CSSProperties = {
    width: '100%',
    height: '12px',
    appearance: 'none',
    border: 'var(--border-width) solid var(--color-border)',
    background: 'var(--color-bg-alt)',
    cursor: 'pointer',
  };

  return (
    <div style={containerStyle}>
      {label && (
        <div style={labelContainerStyle}>
          <span>{label}</span>
          <span>{value}</span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={sliderStyle}
      />
    </div>
  );
}
