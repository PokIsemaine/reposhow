'use client';

import React from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children, actions }: ModalProps) {
  if (!isOpen) return null;

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const modalStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-bg)',
    border: 'var(--border-width) solid var(--color-border)',
    boxShadow: 'var(--shadow-lg)',
    borderRadius: 'var(--radius-md)',
    maxWidth: '480px',
    width: '90%',
    padding: 'var(--space-lg)',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-md)',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 'var(--text-xl)',
    fontWeight: 700,
    margin: 0,
  };

  const closeButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    fontSize: 'var(--text-xl)',
    cursor: 'pointer',
    padding: 'var(--space-xs)',
    lineHeight: 1,
    color: 'var(--color-text-muted)',
  };

  const actionsStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--space-sm)',
    justifyContent: 'flex-end',
    marginTop: 'var(--space-lg)',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>{title}</h2>
          <button style={closeButtonStyle} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div>{children}</div>
        {actions && <div style={actionsStyle}>{actions}</div>}
      </div>
    </div>
  );
}
