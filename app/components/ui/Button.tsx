'use client';

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

const variantStyles = {
  primary: {
    background: 'var(--color-primary)',
    color: 'var(--color-text)',
    border: 'var(--border-width) solid var(--color-border)',
    boxShadow: 'var(--shadow-sm)',
  },
  secondary: {
    background: 'var(--color-secondary)',
    color: 'var(--color-text)',
    border: 'var(--border-width) solid var(--color-border)',
    boxShadow: 'var(--shadow-sm)',
  },
  outline: {
    background: 'transparent',
    color: 'var(--color-text)',
    border: 'var(--border-width) solid var(--color-border)',
    boxShadow: 'none',
  },
  ghost: {
    background: 'transparent',
    color: 'var(--color-text)',
    border: 'none',
    boxShadow: 'none',
  },
};

const sizeStyles = {
  sm: {
    padding: 'var(--space-xs) var(--space-sm)',
    fontSize: 'var(--text-sm)',
  },
  md: {
    padding: 'var(--space-sm) var(--space-md)',
    fontSize: 'var(--text-base)',
  },
  lg: {
    padding: 'var(--space-md) var(--space-lg)',
    fontSize: 'var(--text-lg)',
  },
};

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  style,
  disabled,
  ...props
}: ButtonProps) {
  const [isPressed, setIsPressed] = React.useState(false);

  const baseStyle: React.CSSProperties = {
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'all 0.1s ease',
    transform: isPressed ? 'translate(2px, 2px)' : 'none',
    borderRadius: 'var(--border-radius)',
    ...variantStyles[variant],
    ...sizeStyles[size],
    ...style,
  };

  return (
    <button
      style={baseStyle}
      disabled={disabled}
      onMouseDown={() => !disabled && setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onMouseLeave={() => setIsPressed(false)}
      {...props}
    >
      {children}
    </button>
  );
}
