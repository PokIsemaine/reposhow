'use client';

import React from 'react';

export interface StageInfo {
  id: string;
  label: string;
}

interface ProgressStepsProps {
  stages: StageInfo[];
  currentStage: string;
  overallProgress: number;
  warningStages?: string[];
  onStageClick?: (stageId: string) => void;
}

export function ProgressSteps({ stages, currentStage, overallProgress, warningStages = [], onStageClick }: ProgressStepsProps) {
  const currentIndex = stages.findIndex(s => s.id === currentStage);

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-md)',
  };

  const progressBarContainerStyle: React.CSSProperties = {
    height: '12px',
    border: 'var(--border-width) solid var(--color-border)',
    background: 'var(--color-bg-alt)',
    overflow: 'hidden',
  };

  const progressBarFillStyle: React.CSSProperties = {
    height: '100%',
    width: `${overallProgress}%`,
    background: 'var(--color-success)',
    transition: 'width 0.3s ease',
  };

  const stagesContainerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    position: 'relative',
  };

  const stageStyle = (index: number): React.CSSProperties => {
    const isCompleted = index < currentIndex;
    const isCurrent = index === currentIndex;
    const isPending = index > currentIndex;
    const stageId = stages[index].id;
    const hasWarning = warningStages.includes(stageId);

    return {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 'var(--space-xs)',
      padding: 'var(--space-sm)',
      background: isCurrent ? 'var(--color-primary)' : isCompleted ? 'var(--color-success)' : 'var(--color-bg-alt)',
      border: hasWarning ? '3px solid #f59e0b' : 'var(--border-width) solid var(--color-border)',
      boxShadow: hasWarning ? '0 0 8px rgba(245, 158, 11, 0.4)' : 'none',
      color: isPending ? 'var(--color-text-muted)' : 'var(--color-text)',
      fontSize: 'var(--text-xs)',
      fontWeight: isCurrent ? 700 : 400,
      flex: 1,
      margin: '0 2px',
      cursor: onStageClick ? 'pointer' : 'default',
      transition: 'transform 0.15s ease',
    };
  };

  return (
    <div style={containerStyle}>
      <div style={progressBarContainerStyle}>
        <div style={progressBarFillStyle} />
      </div>
      <div style={stagesContainerStyle}>
        {stages.map((stage, index) => {
          const hasWarning = warningStages.includes(stage.id);
          return (
            <div
              key={stage.id}
              style={stageStyle(index)}
              onClick={() => onStageClick?.(stage.id)}
              role={onStageClick ? "button" : undefined}
              tabIndex={onStageClick ? 0 : undefined}
              onKeyDown={onStageClick ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onStageClick(stage.id);
                }
              } : undefined}
            >
              {hasWarning && (
                <span style={{ fontSize: '14px', marginBottom: '2px' }}>⚠️</span>
              )}
              {stage.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
