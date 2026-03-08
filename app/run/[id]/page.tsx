'use client';

import { useState, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, ProgressSteps, Progress, LogPanel, Badge, Input, Select, Slider } from '../../components/ui';
import type { LogEntry, StageInfo } from '../../components/ui';

interface StageTiming {
  startedAt?: string;
  completedAt?: string;
}

interface RunStatus {
  runId: string;
  stage: string;
  stageProgress: number;
  overallProgress: number;
  error?: string;
  config: {
    repoUrl?: string;
    localPath?: string;
    instructions?: string;
    duration: number;
    resolution: string;
    voiceMode?: string;
    voiceId?: string;
    bgmPreset?: string;
    bgmVolume?: number;
    imagePromptStyle?: string;
    customImagePrompt?: string;
  };
  logs: LogEntry[];
  stageTimings: Record<string, StageTiming>;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  // Analysis progress (for historical display)
  analysisStep?: string;
  analysisStepMessage?: string;
  analysisProgress?: number;
}

const STAGES: StageInfo[] = [
  { id: 'FETCH', label: 'Fetch' },
  { id: 'ANALYZE', label: 'Analyze' },
  { id: 'SCRIPT', label: 'Script' },
  { id: 'STORYBOARD', label: 'Storyboard' },
  { id: 'STORYBOARD_REVIEW', label: 'Review' },
  { id: 'ASSETS', label: 'Assets' },
  { id: 'RENDER', label: 'Render' },
];

const STEP_LABELS: Record<string, string> = {
  init: 'Initializing',
  starting: 'Starting Analysis',
  loading: 'Loading Repository',
  corpus: 'Processing Files',
  analyzing: 'AI Analysis',
  features: 'Extracting Features',
  complete: 'Complete',
};

interface StreamEvent {
  type: 'progress' | 'complete' | 'error';
  step?: string;
  message?: string;
  progress?: number;
  error?: string;
}

/**
 * Format duration in milliseconds to human readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Calculate duration from timing info
 */
function getStageDuration(timing?: StageTiming): string | null {
  if (!timing?.startedAt) return null;
  const start = new Date(timing.startedAt).getTime();
  const end = timing.completedAt ? new Date(timing.completedAt).getTime() : Date.now();
  return formatDuration(end - start);
}

/**
 * Calculate total elapsed time
 */
function getTotalElapsed(startedAt?: string, completedAt?: string): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  return formatDuration(end - start);
}

export default function RunPage({ params, searchParams }: { params: Promise<{ id: string }>, searchParams: Promise<{ from?: string }> }) {
  const { id } = use(params);
  const resolvedSearchParams = use(searchParams);
  const fromProjects = resolvedSearchParams.from === 'projects';
  const router = useRouter();
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [polling, setPolling] = useState(true);
  const [visitedStoryboardReview, setVisitedStoryboardReview] = useState(false);
  const [visitedAnalysis, setVisitedAnalysis] = useState(false);
  const [analysisNeedsClarification, setAnalysisNeedsClarification] = useState(false);
  const [analysisStep, setAnalysisStep] = useState<string>('init');
  const [analysisStepMessage, setAnalysisStepMessage] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    instructions: '',
    duration: 60,
    resolution: 'youtube' as 'youtube' | 'x' | 'tiktok',
    voiceMode: 'preset' as 'preset' | 'clone',
    voiceId: '',
    bgmPreset: 'upbeat',
    bgmVolume: 30,
  });
  const [availableVoices, setAvailableVoices] = useState<Array<{ voice_id: string; name: string; source: string }>>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Use ref to store current stage to avoid SSE effect re-running on every status update
  const stageRef = useRef(status?.stage);
  useEffect(() => {
    stageRef.current = status?.stage;
  }, [status?.stage]);

  // Check localStorage for visited storyboard review
  useEffect(() => {
    const storageKey = `visited_storyboard_${id}`;
    const visited = localStorage.getItem(storageKey);
    if (visited) {
      setVisitedStoryboardReview(true);
    }
  }, [id]);

  // Check localStorage for visited analysis
  useEffect(() => {
    const storageKey = `visited_analysis_${id}`;
    const visited = localStorage.getItem(storageKey);
    if (visited) {
      setVisitedAnalysis(true);
    }
  }, [id]);

  // Fetch available voices
  useEffect(() => {
    async function fetchVoices() {
      try {
        const response = await fetch('/api/voices');
        if (response.ok) {
          const data = await response.json();
          setAvailableVoices(data.voices || []);
        }
      } catch (err) {
        console.error('Failed to fetch voices:', err);
      } finally {
        setLoadingVoices(false);
      }
    }
    fetchVoices();
  }, []);

  const fetchStatus = async () => {
    try {
      const response = await fetch(`/api/runs/${id}/status`);
      if (!response.ok) {
        throw new Error('Failed to fetch status');
      }
      const data = await response.json();

      // Only update state if data actually changed to prevent unnecessary re-renders
      setStatus(prev => {
        if (JSON.stringify(prev) === JSON.stringify(data)) {
          return prev; // Same data, don't trigger re-render
        }
        return data;
      });

      // Initialize analysis progress from status if available (for page refresh)
      if (data.stage === 'ANALYZE' && data.analysisStep) {
        setAnalysisStep(data.analysisStep);
        setAnalysisStepMessage(data.analysisStepMessage || '');
        setAnalysisProgress(data.analysisProgress || 0);
      }

      // Fetch analysis details to check for clarification needs
      if (['ANALYZE', 'SCRIPT', 'STORYBOARD', 'STORYBOARD_REVIEW', 'ASSETS', 'RENDER'].includes(data.stage)) {
        try {
          const analysisResponse = await fetch(`/api/runs/${id}/analysis`);
          if (analysisResponse.ok) {
            const analysisData = await analysisResponse.json();
            // Update state for UI display
            if (analysisData.needsClarification) {
              setAnalysisNeedsClarification(true);
            }
            // FIX: Check and redirect immediately instead of relying on stale state
            const storageKey = `visited_analysis_${id}`;
            const hasVisitedAnalysis = localStorage.getItem(storageKey);
            if (analysisData.needsClarification && !hasVisitedAnalysis && data.stage !== 'ANALYZE' && !fromProjects) {
              setPolling(false);
              localStorage.setItem(storageKey, 'true');
              setVisitedAnalysis(true);
              setTimeout(() => {
                router.push(`/analysis/${id}`);
              }, 1000);
              return; // Early return to avoid further processing
            }
          }
        } catch (e) {
          // Ignore analysis fetch errors
        }
      }

      // Stop polling if completed/failed/cancelled
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(data.stage)) {
        setPolling(false);

        // Redirect to result if completed
        if (data.stage === 'COMPLETED' && !fromProjects) {
          setTimeout(() => {
            router.push(`/result/${id}`);
          }, 2000);
        }
      }

      // Only auto-redirect to storyboard review on first visit
      if (data.stage === 'STORYBOARD_REVIEW' && !visitedStoryboardReview && !fromProjects) {
        setPolling(false);
        // Mark as visited before redirect
        const storageKey = `visited_storyboard_${id}`;
        localStorage.setItem(storageKey, 'true');
        setVisitedStoryboardReview(true);
        setTimeout(() => {
          router.push(`/storyboard/${id}`);
        }, 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  };

  // Handle click on progress stage
  const handleStageClick = (stageId: string) => {
    if (stageId === 'ANALYZE') {
      const storageKey = `visited_analysis_${id}`;
      localStorage.setItem(storageKey, 'true');
      setVisitedAnalysis(true);
      router.push(`/analysis/${id}`);
    } else if (stageId === 'STORYBOARD_REVIEW') {
      const storageKey = `visited_storyboard_${id}`;
      localStorage.setItem(storageKey, 'true');
      setVisitedStoryboardReview(true);
      router.push(`/storyboard/${id}`);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [id]);

  // Poll for updates
  useEffect(() => {
    if (!polling) return;

    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [polling, id]);

  // Connect to SSE stream for analysis sub-steps
  useEffect(() => {
    if (stageRef.current !== 'ANALYZE') return;

    const eventSource = new EventSource(`/api/runs/${id}/analyze/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);

        if (data.type === 'progress') {
          setAnalysisStep(data.step || 'init');
          setAnalysisStepMessage(data.message || '');
          setAnalysisProgress(data.progress || 0);
        } else if (data.type === 'complete') {
          setAnalysisStep('complete');
          setAnalysisStepMessage('Analysis complete!');
          setAnalysisProgress(100);
          eventSource.close();
        } else if (data.type === 'error') {
          console.error('Analysis error:', data.error);
          eventSource.close();
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [id]);

  const handleRetry = async () => {
    try {
      await fetch(`/api/runs/${id}/retry`, { method: 'POST' });
      setPolling(true);
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry');
    }
  };

  const handleCancel = async () => {
    try {
      await fetch(`/api/runs/${id}/cancel`, { method: 'POST' });
      setPolling(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
    }
  };

  const handleOpenEditModal = () => {
    if (status?.config) {
      setEditForm({
        instructions: status.config.instructions || '',
        duration: status.config.duration || 60,
        resolution: (status.config.resolution as 'youtube' | 'x' | 'tiktok') || 'youtube',
        voiceMode: (status.config.voiceMode as 'preset' | 'clone') || 'preset',
        voiceId: status.config.voiceId || '',
        bgmPreset: status.config.bgmPreset || 'upbeat',
        bgmVolume: status.config.bgmVolume || 30,
      });
    }
    setShowEditModal(true);
  };

  const handleEditSubmit = async () => {
    if (!confirm('编辑配置将重新生成视频，当前视频将被覆盖。是否继续？')) {
      return;
    }

    setEditSubmitting(true);
    try {
      const response = await fetch(`/api/runs/${id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: editForm }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update config');
      }

      setShowEditModal(false);
      setPolling(true);
      fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update config');
    } finally {
      setEditSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        Loading...
      </div>
    );
  }

  if (error && !status) {
    return (
      <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-error)' }}>{error}</p>
        <Button onClick={() => router.push('/')} style={{ marginTop: 'var(--space-md)' }}>
          Go Home
        </Button>
      </div>
    );
  }

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    padding: 'var(--space-xl) var(--space-md)',
  };

  const headerStyle: React.CSSProperties = {
    maxWidth: '800px',
    margin: '0 auto var(--space-xl)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-md)',
  };

  const statusBadgeVariant = (stage: string) => {
    switch (stage) {
      case 'COMPLETED': return 'success';
      case 'FAILED': return 'error';
      case 'CANCELLED': return 'warning';
      default: return 'default';
    }
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>Generating Video</h1>
          <Badge variant={statusBadgeVariant(status?.stage || '')}>
            {status?.stage || 'UNKNOWN'}
          </Badge>
        </div>
        <Link href="/projects">
          <Button variant="outline" size="sm">Projects</Button>
        </Link>
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
        {/* Run Info */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
            <h3 style={{ margin: 0 }}>Run Details</h3>
            {['COMPLETED', 'FAILED', 'CANCELLED'].includes(status?.stage || '') && (
              <Button size="sm" onClick={handleOpenEditModal}>
                Edit Config
              </Button>
            )}
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-sm)', fontSize: 'var(--text-sm)' }}>
            <div>
              <strong>Repository:</strong> {status?.config?.repoUrl || status?.config?.localPath || 'N/A'}
            </div>
            {status?.config?.instructions && (
              <div>
                <strong>Instructions:</strong>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: '#666', maxHeight: '60px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {status.config.instructions}
                </p>
              </div>
            )}
            <div>
              <strong>Duration:</strong> {status?.config?.duration}s | <strong>Resolution:</strong> {status?.config?.resolution}
            </div>
            <div>
              <strong>Voice:</strong> {status?.config?.voiceMode === 'clone' ? 'Voice Clone' : 'Preset'}
              {status?.config?.voiceId && ` (${status.config.voiceId})`}
            </div>
            <div>
              <strong>Background Music:</strong> {status?.config?.bgmPreset || 'upbeat'} | Volume: {status?.config?.bgmVolume ?? 30}%
            </div>
            <div>
              <strong>Image Style:</strong> {status?.config?.imagePromptStyle === 'none' ? 'Default (AI style)' : status?.config?.imagePromptStyle || 'Default'}
              {status?.config?.imagePromptStyle === 'custom' && status?.config?.customImagePrompt && (
                <span style={{ fontSize: 'var(--text-xs)', color: '#666', marginLeft: '8px' }}>
                  ({status.config.customImagePrompt.slice(0, 50)}{status.config.customImagePrompt.length > 50 ? '...' : ''})
                </span>
              )}
            </div>
            <div>
              <strong>Last Updated:</strong> {status?.updatedAt ? new Date(status.updatedAt).toLocaleString() : 'N/A'}
            </div>
          </div>
        </Card>

        {/* Progress */}
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
            <h3 style={{ margin: 0 }}>Progress</h3>
          </div>
          <ProgressSteps
            stages={STAGES}
            currentStage={status?.stage || 'QUEUED'}
            overallProgress={status?.overallProgress || 0}
            warningStages={analysisNeedsClarification ? ['ANALYZE'] : []}
            onStageClick={handleStageClick}
          />
          {/* Analysis sub-steps progress */}
          {status?.stage === 'ANALYZE' && analysisStep !== 'complete' && (
            <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-md)', background: 'var(--color-bg)', border: 'var(--border-width) solid var(--color-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
                <span style={{ fontWeight: 600 }}>{STEP_LABELS[analysisStep] || analysisStep}</span>
                <span>{analysisProgress}%</span>
              </div>
              <Progress value={analysisProgress} />
              {analysisStepMessage && (
                <p style={{ fontSize: 'var(--text-sm)', color: '#666', margin: 'var(--space-xs) 0 0' }}>
                  {analysisStepMessage}
                </p>
              )}
            </div>
          )}
          {/* Stage timings */}
          {status?.startedAt && (
            <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: 'var(--border-width) solid var(--color-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                <strong>Elapsed Time:</strong>
                <span>{getTotalElapsed(status.startedAt, status.completedAt)}</span>
              </div>
              <div style={{ display: 'grid', gap: 'var(--space-xs)', fontSize: 'var(--text-xs)' }}>
                {STAGES.map(stage => {
                  const timing = status.stageTimings?.[stage.id];
                  const duration = getStageDuration(timing);
                  if (!timing?.startedAt) return null;
                  return (
                    <div key={stage.id} style={{ display: 'flex', justifyContent: 'space-between', color: timing.completedAt ? 'var(--color-text)' : 'var(--color-primary)' }}>
                      <span>{stage.label}:</span>
                      <span>{duration || 'in progress...'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* Error */}
        {status?.error && (
          <Card style={{ background: '#fff5f5', borderColor: 'var(--color-error)' }}>
            <h3 style={{ color: 'var(--color-error)', marginBottom: 'var(--space-sm)' }}>Error</h3>
            <p>{status.error}</p>
          </Card>
        )}

        {/* Logs */}
        <Card>
          <h3 style={{ marginBottom: 'var(--space-md)' }}>Logs</h3>
          <LogPanel logs={status?.logs || []} maxHeight="400px" />
        </Card>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end' }}>
          {status?.stage === 'FAILED' && (
            <Button onClick={handleRetry}>Retry</Button>
          )}
          {['QUEUED', 'FETCH', 'ANALYZE', 'SCRIPT', 'STORYBOARD', 'STORYBOARD_REVIEW', 'ASSETS', 'RENDER'].includes(status?.stage || '') && (
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Edit Config Modal */}
      {showEditModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <Card style={{ maxWidth: '600px', width: '90%', maxHeight: '90vh', overflow: 'auto' }}>
            <h2 style={{ marginBottom: 'var(--space-lg)' }}>Edit Configuration</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {/* Repository (read-only) */}
              <div>
                <label style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>Repository</label>
                <Input
                  value={status?.config?.repoUrl || status?.config?.localPath || ''}
                  disabled
                  style={{ marginTop: '4px', opacity: 0.6 }}
                />
                <p style={{ fontSize: 'var(--text-xs)', color: '#666', margin: '4px 0 0' }}>
                  Repository URL cannot be changed. Create a new run to use a different repository.
                </p>
              </div>

              {/* Instructions */}
              <div>
                <label style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>Instructions</label>
                <textarea
                  style={{
                    width: '100%',
                    minHeight: '100px',
                    padding: 'var(--space-sm)',
                    marginTop: '4px',
                    fontSize: 'var(--text-sm)',
                    fontFamily: 'monospace',
                    border: 'var(--border-width) solid var(--color-border)',
                    resize: 'vertical',
                  }}
                  value={editForm.instructions}
                  onChange={(e) => setEditForm(prev => ({ ...prev, instructions: e.target.value }))}
                  placeholder="Enter custom instructions for video generation..."
                />
              </div>

              {/* Duration & Resolution */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <Select
                  label="Duration"
                  value={String(editForm.duration)}
                  options={[
                    { value: '30', label: '30 seconds' },
                    { value: '60', label: '60 seconds' },
                    { value: '90', label: '90 seconds' },
                  ]}
                  onChange={(v) => setEditForm(prev => ({ ...prev, duration: Number(v) }))}
                />
                <Select
                  label="Resolution"
                  value={editForm.resolution}
                  options={[
                    { value: 'youtube', label: 'YouTube (1920×1080)' },
                    { value: 'x', label: 'X / Twitter (1280×720)' },
                    { value: 'tiktok', label: 'TikTok (1080×1920)' },
                  ]}
                  onChange={(v) => setEditForm(prev => ({ ...prev, resolution: v as 'youtube' | 'x' | 'tiktok' }))}
                />
              </div>

              {/* Voice Mode & Voice */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <Select
                  label="Voice Mode"
                  value={editForm.voiceMode}
                  options={[
                    { value: 'preset', label: 'Preset Voice' },
                    { value: 'clone', label: 'Voice Clone' },
                  ]}
                  onChange={(v) => setEditForm(prev => ({ ...prev, voiceMode: v as 'preset' | 'clone' }))}
                />
                <Select
                  label={loadingVoices ? 'Voice (Loading...)' : 'Voice'}
                  value={editForm.voiceId}
                  options={availableVoices.map(v => ({
                    value: v.voice_id,
                    label: `${v.name} (${v.source})`,
                  }))}
                  onChange={(v) => setEditForm(prev => ({ ...prev, voiceId: v }))}
                  disabled={loadingVoices || editForm.voiceMode === 'clone'}
                />
              </div>

              {/* BGM */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                <Select
                  label="Music Style"
                  value={editForm.bgmPreset}
                  options={[
                    { value: 'upbeat', label: 'Upbeat' },
                    { value: 'calm', label: 'Calm' },
                    { value: 'energetic', label: 'Energetic' },
                    { value: 'minimal', label: 'Minimal' },
                  ]}
                  onChange={(v) => setEditForm(prev => ({ ...prev, bgmPreset: v }))}
                />
                <Slider
                  label="Music Volume"
                  min={0}
                  max={100}
                  value={editForm.bgmVolume}
                  onChange={(v) => setEditForm(prev => ({ ...prev, bgmVolume: v }))}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end', marginTop: 'var(--space-lg)' }}>
              <Button variant="outline" onClick={() => setShowEditModal(false)} disabled={editSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleEditSubmit} disabled={editSubmitting}>
                {editSubmitting ? 'Applying...' : 'Apply & Regenerate'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
