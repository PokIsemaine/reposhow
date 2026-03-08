'use client';

import React from 'react';

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'error';
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Badge({ variant = 'default', children, style }: BadgeProps) {
  const variantColors = {
    default: { bg: 'var(--color-bg-alt)', color: 'var(--color-text)' },
    success: { bg: 'var(--color-success)', color: '#fff' },
    warning: { bg: 'var(--color-warning)', color: '#fff' },
    error: { bg: 'var(--color-error)', color: '#fff' },
  };

  const badgeStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px var(--space-sm)',
    fontSize: 'var(--text-xs)',
    fontWeight: 700,
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 'var(--border-radius)',
    background: variantColors[variant].bg,
    color: variantColors[variant].color,
    ...style,
  };

  return <span style={badgeStyle}>{children}</span>;
}
