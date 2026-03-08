'use client';

import { useState, useEffect, useRef } from 'react';
import { Button, Card, Progress } from './ui';

interface AssetStatus {
  stage: string;
  stageProgress: number;
  overallProgress: number;
  error?: string;
  artifacts?: {
    images?: string[];
    voiceAudio?: string;
    bgmAudio?: string;
  };
}

interface LogEntry {
  timestamp: string;
  level: string;
  stage?: string;
  message: string;
}

interface AssetGenerationPanelProps {
  runId: string;
  onComplete: () => void;
}

export function AssetGenerationPanel({ runId, onComplete }: AssetGenerationPanelProps) {
  const [status, setStatus] = useState<AssetStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [polling, setPolling] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Fetch status and logs
  const fetchStatus = async () => {
    try {
      const response = await fetch(`/api/runs/${runId}/status`);
      if (!response.ok) {
        throw new Error('Failed to fetch status');
      }
      const data = await response.json();
      setStatus(data);
      setLogs(data.logs || []);

      // Check if completed ASSETS stage
      if (data.stage === 'RENDER' || data.stage === 'COMPLETE' || data.stage === 'DONE') {
        setPolling(false);
        // Load image list
        setImages(data.artifacts?.images || []);
      } else if (data.error) {
        setError(data.error);
        setPolling(false);
      }
    } catch (err) {
      console.error('Error fetching status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [runId]);

  // Poll every 2 seconds
  useEffect(() => {
    if (!polling) return;

    const interval = setInterval(() => {
      fetchStatus();
    }, 2000);

    return () => clearInterval(interval);
  }, [polling, runId]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        Loading asset generation status...
      </div>
    );
  }

  const isCompleted = status?.stage === 'RENDER' || status?.stage === 'COMPLETE' || status?.stage === 'DONE';
  const hasError = !!error || !!status?.error;

  // Determine current phase
  const getCurrentPhase = () => {
    if (!status) return 'Loading...';
    if (status.stage === 'ASSETS') {
      if (status.stageProgress < 40) return 'Generating Images';
      if (status.stageProgress < 50) return 'Processing Images';
      if (status.stageProgress < 70) return 'Generating Voiceover';
      if (status.stageProgress < 80) return 'Processing Audio';
      if (status.stageProgress < 90) return 'Generating Background Music';
      return 'Finalizing Assets';
    }
    if (isCompleted) return 'Assets Complete';
    return status.stage;
  };

  // Scene status based on logs
  const getSceneStatuses = () => {
    const sceneStatuses: Record<number, 'pending' | 'generating' | 'complete' | 'error'> = {};

    logs.forEach(log => {
      const match = log.message.match(/Generating image for scene (\d+)/);
      if (match) {
        const sceneNum = parseInt(match[1]);
        sceneStatuses[sceneNum] = 'generating';
      }

      const savedMatch = log.message.match(/Saved image: scene_(\d+)\.png/);
      if (savedMatch) {
        const sceneNum = parseInt(savedMatch[1]);
        sceneStatuses[sceneNum] = 'complete';
      }

      const errorMatch = log.message.match(/Failed to generate image for scene (\d+)/);
      if (errorMatch) {
        const sceneNum = parseInt(errorMatch[1]);
        sceneStatuses[sceneNum] = 'error';
      }
    });

    return sceneStatuses;
  };

  const sceneStatuses = getSceneStatuses();
  const totalScenes = images.length || 6; // Default to 6 if unknown

  // Generate scene numbers (1 to totalScenes)
  const sceneNumbers = Array.from({ length: totalScenes }, (_, i) => i + 1);

  const containerStyle: React.CSSProperties = {
    maxWidth: '900px',
    margin: '0 auto',
  };

  const panelStyle: React.CSSProperties = {
    marginBottom: 'var(--space-lg)',
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h2 style={{ margin: '0 0 var(--space-sm)' }}>Generating Assets</h2>
        <p style={{ margin: 0, color: '#666' }}>
          Please wait while we generate images, voiceover, and background music...
        </p>
      </div>

      {/* Progress Card */}
      <Card style={panelStyle}>
        <div style={{ marginBottom: 'var(--space-lg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
            <span style={{ fontWeight: 600 }}>{getCurrentPhase()}</span>
            <span>{status?.stageProgress || 0}%</span>
          </div>
          <Progress value={status?.stageProgress || 0} />
        </div>

        {/* Scene Status Grid */}
        <div style={{ marginTop: 'var(--space-lg)' }}>
          <h4 style={{ margin: '0 0 var(--space-md)', fontSize: 'var(--text-sm)', color: '#666' }}>
            Scene Images
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 'var(--space-sm)' }}>
            {sceneNumbers.map(num => {
              const sceneStatus = sceneStatuses[num] || 'pending';
              const icons: Record<string, string> = {
                pending: '⏳',
                generating: '🔄',
                complete: '✅',
                error: '❌',
              };
              return (
                <div
                  key={num}
                  style={{
                    textAlign: 'center',
                    padding: 'var(--space-sm)',
                    background: sceneStatus === 'complete' ? '#f0fff4' : sceneStatus === 'error' ? '#fff5f5' : '#f9f9f9',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div style={{ fontSize: '20px' }}>{icons[sceneStatus]}</div>
                  <div style={{ fontSize: 'var(--text-xs)', marginTop: '4px' }}>
                    Scene {String(num).padStart(2, '0')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Error Message */}
      {hasError && (
        <Card style={{ ...panelStyle, background: '#fff5f5', borderColor: 'var(--color-error)' }}>
          <p style={{ color: 'var(--color-error)', margin: 0 }}>
            {error || status?.error}
          </p>
        </Card>
      )}

      {/* Log Panel */}
      <Card style={panelStyle}>
        <h4 style={{ margin: '0 0 var(--space-md)', fontSize: 'var(--text-sm)', color: '#666' }}>
          Generation Logs
        </h4>
        <div
          ref={logContainerRef}
          style={{
            height: '200px',
            overflowY: 'auto',
            background: '#1a1a2e',
            color: '#eee',
            padding: 'var(--space-md)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'monospace',
            fontSize: 'var(--text-xs)',
          }}
        >
          {logs.slice(-30).map((log, i) => (
            <div
              key={i}
              style={{
                marginBottom: '4px',
                color: log.level === 'ERROR' ? '#ff6b6b' : log.level === 'WARN' ? '#ffd93d' : '#aaa',
              }}
            >
              <span style={{ color: '#666', marginRight: '8px' }}>
                [{new Date(log.timestamp).toLocaleTimeString()}]
              </span>
              <span style={{ color: '#4ecdc4' }}>[{log.stage}]</span>
              <span style={{ marginLeft: '8px' }}>{log.message}</span>
            </div>
          ))}
          {logs.length === 0 && <div style={{ color: '#666' }}>Waiting for logs...</div>}
        </div>
      </Card>

      {/* Image Preview (when completed) */}
      {isCompleted && images.length > 0 && (
        <Card style={{ ...panelStyle, borderColor: 'var(--color-success)' }}>
          <h4 style={{ margin: '0 0 var(--space-md)', fontSize: 'var(--text-sm)', color: '#666' }}>
            Generated Images Preview
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--space-md)' }}>
            {images.map((img, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <img
                  src={`/api/runs/${runId}/assets/${img}`}
                  alt={`Scene ${i + 1}`}
                  style={{
                    width: '100%',
                    aspectRatio: '16/9',
                    objectFit: 'cover',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="120" height="68" viewBox="0 0 120 68"><rect fill="%23f0f0f0" width="120" height="68"/><text x="60" y="34" text-anchor="middle" fill="%23999" font-size="10">Image</text></svg>';
                  }}
                />
                <div style={{ fontSize: 'var(--text-xs)', marginTop: '4px' }}>
                  Scene {String(i + 1).padStart(2, '0')}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Completion Actions */}
      {isCompleted && (
        <Card style={{ ...panelStyle, background: '#f0fff4', borderColor: 'var(--color-success)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
            <div>
              <h3 style={{ margin: '0 0 var(--space-xs)', color: 'var(--color-success)' }}>
                Assets Generated Successfully!
              </h3>
              <p style={{ margin: 0, color: '#666' }}>
                All images, voiceover, and background music are ready.
              </p>
            </div>
            <Button onClick={onComplete} style={{ minWidth: '180px' }}>
              Continue to Rendering →
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
