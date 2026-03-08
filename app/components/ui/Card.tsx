'use client';

import React from 'react';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'accent';
  style?: React.CSSProperties;
}

export function Card({ children, variant = 'default', style }: CardProps) {
  const cardStyle: React.CSSProperties = {
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 'var(--border-radius)',
    background: variant === 'accent' ? 'var(--color-accent)' : 'var(--color-bg)',
    boxShadow: 'var(--shadow-md)',
    padding: 'var(--space-lg)',
    ...style,
  };

  return <div style={cardStyle}>{children}</div>;
}
