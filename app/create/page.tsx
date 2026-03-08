'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Input, Card, Select, Slider } from '../components/ui';
import VoiceRecorder from '../components/VoiceRecorder';

// Preset prompt templates
const PRESET_PROMPTS: Record<string, string> = {
  Technical: `Analyze this repository with a focus on:
- Technical architecture and design patterns
- Key components and their responsibilities
- Code quality and best practices
- Notable implementations or algorithms

Create a video script that showcases the technical excellence of this project.`,
  Marketing: `Analyze this repository highlighting:
- What problems this project solves
- Key features and benefits for users
- Why users should choose this project
- Community adoption and use cases

Create a compelling marketing video that drives interest and action.`,
  Minimal: `Provide a concise overview of this repository:
- What the project does (one sentence)
- Main features (3-5 bullet points)
- Key highlights

Create a brief, focused video that gets to the point quickly.`,
  Detailed: `Create a comprehensive analysis of this repository:
- Project background and purpose
- All major features and capabilities
- Technical implementation details
- Code examples and demonstrations
- Comparison with alternatives
- Installation and usage instructions

Create an in-depth educational video covering everything.`,
};

function CreateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [formData, setFormData] = useState<{
    repoUrl: string;
    instructions: string;
    customPrompt: string;
    duration: number;
    resolution: 'youtube' | 'x' | 'tiktok';
    voiceMode: 'preset' | 'clone';
    voiceId: string;
    voiceSample: string;
    bgmPreset: string;
    bgmVolume: number;
    imagePromptStyle: 'none' | 'flat-illustration' | 'tech-dashboard' | '3d-render' | 'minimal' | 'custom';
    customImagePrompt: string;
  }>({
    repoUrl: '',
    instructions: '',
    customPrompt: '',
    duration: 60,
    resolution: 'youtube',
    voiceMode: 'preset',
    voiceId: '',
    voiceSample: '',
    bgmPreset: 'upbeat',
    bgmVolume: 30,
    imagePromptStyle: 'none',
    customImagePrompt: '',
  });
  const [instructionsExpanded, setInstructionsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [availableVoices, setAvailableVoices] = useState<Array<{ voice_id: string; name: string; source: string }>>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [repoLocked, setRepoLocked] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectRepoUrl, setProjectRepoUrl] = useState<string | null>(null);

  // Fetch available voices on mount
  useEffect(() => {
    async function fetchVoices() {
      try {
        const response = await fetch('/api/voices');
        if (response.ok) {
          const data = await response.json();
          setAvailableVoices(data.voices || []);
          // Set default voice to first available if none selected
          if (data.voices && data.voices.length > 0 && !formData.voiceId) {
            setFormData(prev => ({ ...prev, voiceId: data.voices[0].voice_id }));
          }
        } else {
          const errorData = await response.json();
          console.error('Failed to fetch voices:', errorData.error);
        }
      } catch (err) {
        console.error('Failed to fetch voices:', err);
      } finally {
        setLoadingVoices(false);
      }
    }
    fetchVoices();
  }, []);

  // Pre-fill repo URL from query param or fetch project
  useEffect(() => {
    const repo = searchParams.get('repo');
    const locked = searchParams.get('locked');
    const pid = searchParams.get('projectId');

    if (repo) {
      setFormData(prev => ({ ...prev, repoUrl: repo }));
    }
    if (locked === 'true') {
      setRepoLocked(true);
    }
    if (pid) {
      setProjectId(pid);
      // Fetch project to get repoUrl
      fetch(`/api/projects/${pid}`)
        .then(res => res.json())
        .then(data => {
          if (data.project?.repoUrl) {
            setProjectRepoUrl(data.project.repoUrl);
            setFormData(prev => ({
              ...prev,
              repoUrl: data.project.repoUrl,
              // Project runs don't support voice cloning, default to preset
              voiceMode: 'preset',
            }));
            setRepoLocked(true);
          }
        })
        .catch(err => console.error('Failed to fetch project:', err));
    }
  }, [searchParams]);

  // Extract owner/repo from GitHub URL
  const extractRepoInfo = (url: string): { owner: string; repo: string } | null => {
    // Trim trailing slashes and whitespace
    const cleanUrl = url.trim().replace(/\/+$/, '');

    const patterns = [
      /(?:www\.)?github\.com\/([^\/]+)\/([^\/\s]+)/,
      /^([^\/]+)\/([^\/\s]+)$/,
    ];
    for (const pattern of patterns) {
      const match = cleanUrl.match(pattern);
      if (match && match[1] && match[2]) {
        // Remove .git suffix if present
        const repo = match[2].replace(/\.git$/, '');
        return { owner: match[1], repo };
      }
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate repo URL (skip in project mode since it's locked)
    if (!projectId) {
      if (!formData.repoUrl.trim()) {
        setError('Please enter a GitHub repository URL');
        return;
      }

      const repoInfo = extractRepoInfo(formData.repoUrl);
      if (!repoInfo) {
        setError('Invalid GitHub URL. Use format: https://github.com/owner/repo');
        return;
      }
    }

    // Validate instructions
    if (!formData.instructions) {
      setError('Please select an instruction preset or enter a custom prompt');
      return;
    }

    // Validate voice sample for clone mode (not available in project mode)
    if (formData.voiceMode === 'clone' && !projectId && !formData.voiceSample) {
      setError('Please record a voice sample for voice cloning');
      return;
    }

    // Validate voice selection for preset mode or project mode (which only supports preset)
    if ((formData.voiceMode === 'preset' || projectId) && !formData.voiceId) {
      setError('No voices available. Please check your ElevenLabs API key.');
      return;
    }

    setLoading(true);

    try {
      // Send combined instructions + custom prompt
      const instructions = formData.instructions === 'Custom' && formData.customPrompt
        ? formData.customPrompt
        : (PRESET_PROMPTS[formData.instructions] || formData.customPrompt);

      // Build request body
      const requestBody: Record<string, unknown> = {
        instructions,
        duration: formData.duration,
        resolution: formData.resolution,
        voiceMode: formData.voiceMode,
        voiceId: formData.voiceId,
        bgmPreset: formData.bgmPreset,
        bgmVolume: formData.bgmVolume,
        imagePromptStyle: formData.imagePromptStyle,
        customImagePrompt: formData.customImagePrompt,
      };

      // For project runs, don't include voiceSample (not supported)
      if (!projectId && formData.voiceSample) {
        requestBody.voiceSample = formData.voiceSample;
      }

      // Choose API endpoint based on whether we're in project mode
      const apiUrl = projectId
        ? `/api/projects/${projectId}/runs`
        : '/api/runs';

      // For non-project mode, include repoUrl
      if (!projectId) {
        requestBody.repoUrl = formData.repoUrl;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create run');
      }

      const { runId } = await response.json();
      router.push(`/run/${runId}${projectId ? '?from=projects' : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    padding: 'var(--space-xl) var(--space-md)',
  };

  const formStyle: React.CSSProperties = {
    maxWidth: '800px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xl)',
  };

  const sectionStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-md)',
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 'var(--text-lg)',
    fontWeight: 700,
    paddingBottom: 'var(--space-sm)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
  };

  const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 'var(--space-md)',
  };

  const chipContainerStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--space-sm)',
    flexWrap: 'wrap',
  };

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: 'var(--space-xs) var(--space-sm)',
    border: 'var(--border-width) solid var(--color-border)',
    background: active ? 'var(--color-primary)' : 'var(--color-bg)',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 700,
  });

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-lg)',
  };

  return (
    <div style={containerStyle}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        <div style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <h1 style={{ margin: 0 }}>Create Video</h1>
            {projectId && (
              <span style={{
                fontSize: 'var(--text-sm)',
                padding: 'var(--space-xs) var(--space-sm)',
                background: 'var(--color-primary)',
                color: 'white',
                borderRadius: 'var(--border-radius)',
              }}>
                Project Run
              </span>
            )}
          </div>
          <Link href={projectId ? `/projects/${projectId}` : '/projects'}>
            <Button variant="outline" size="sm">Projects</Button>
          </Link>
        </div>

        <form onSubmit={handleSubmit} style={formStyle}>
          {/* Repository Source */}
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Repository</h2>
            <Input
              label="GitHub Repository URL"
              placeholder="https://github.com/owner/repo"
              value={formData.repoUrl}
              onChange={(e) => setFormData(prev => ({ ...prev, repoUrl: e.target.value }))}
              disabled={repoLocked}
              style={repoLocked ? {
                background: 'var(--color-bg-alt)',
                color: 'var(--color-text-muted)',
                cursor: 'not-allowed',
              } : undefined}
            />
            {formData.repoUrl && extractRepoInfo(formData.repoUrl) && (
              <a
                href={formData.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-xs)',
                  textDecoration: 'none',
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
                <span style={{ fontWeight: 700 }}>{extractRepoInfo(formData.repoUrl)?.owner}</span>
                <span>/</span>
                <span style={{ fontWeight: 700 }}>{extractRepoInfo(formData.repoUrl)?.repo}</span>
                <span style={{ fontSize: 'var(--text-xs)', marginLeft: 'var(--space-xs)' }}>↗</span>
              </a>
            )}

          </section>

          {/* Custom Instructions */}
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Instructions *</h2>
            <div>
              <label style={{ fontSize: 'var(--text-sm)', fontWeight: 700, display: 'block', marginBottom: 'var(--space-sm)' }}>
                Select a preset or enter custom instructions
              </label>
              <div style={chipContainerStyle}>
                {['Technical', 'Marketing', 'Minimal', 'Detailed', 'Custom'].map(chip => (
                  <span
                    key={chip}
                    style={chipStyle(formData.instructions === chip)}
                    onClick={() => setFormData(prev => ({ ...prev, instructions: chip }))}
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            {/* Expand/collapse area */}
            {formData.instructions && (
              <div
                style={{
                  marginTop: 'var(--space-md)',
                  padding: 'var(--space-md)',
                  border: 'var(--border-width) solid var(--color-border)',
                  cursor: 'pointer',
                }}
                onClick={() => setInstructionsExpanded(!instructionsExpanded)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>
                    {formData.instructions === 'Custom' ? 'Custom Prompt' : `${formData.instructions} Prompt`}
                  </span>
                  <span style={{ fontSize: 'var(--text-sm)' }}>
                    {instructionsExpanded ? '▲ Hide' : '▼ Show'}
                  </span>
                </div>

                {instructionsExpanded && (
                  <div style={{ marginTop: 'var(--space-md)' }}>
                    {formData.instructions === 'Custom' ? (
                      <textarea
                        style={{
                          width: '100%',
                          minHeight: '200px',
                          padding: 'var(--space-sm)',
                          fontSize: 'var(--text-sm)',
                          fontFamily: 'monospace',
                          border: 'var(--border-width) solid var(--color-border)',
                          resize: 'vertical',
                        }}
                        placeholder="Enter your custom instructions here..."
                        value={formData.customPrompt}
                        onChange={(e) => setFormData(prev => ({ ...prev, customPrompt: e.target.value }))}
                      />
                    ) : (
                      <pre style={{
                        whiteSpace: 'pre-wrap',
                        fontSize: 'var(--text-sm)',
                        fontFamily: 'monospace',
                        background: 'var(--color-bg-secondary)',
                        padding: 'var(--space-sm)',
                        margin: 0,
                      }}>
                        {PRESET_PROMPTS[formData.instructions]}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {!formData.instructions && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)', marginTop: 'var(--space-sm)' }}>
                Please select an instruction preset or enter custom instructions
              </p>
            )}
          </section>

          {/* Output Settings */}
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Output Settings</h2>
            <div style={rowStyle}>
              <Select
                label="Duration"
                value={String(formData.duration)}
                options={[
                  { value: '30', label: '30 seconds' },
                  { value: '60', label: '60 seconds' },
                  { value: '90', label: '90 seconds' },
                ]}
                onChange={(v) => setFormData(prev => ({ ...prev, duration: Number(v) }))}
              />
              <Select
                label="Resolution"
                value={formData.resolution}
                options={[
                  { value: 'youtube', label: 'YouTube (1920×1080)' },
                  { value: 'x', label: 'X / Twitter (1280×720)' },
                  { value: 'tiktok', label: 'TikTok (1080×1920)' },
                ]}
                onChange={(v) => setFormData(prev => ({ ...prev, resolution: v as 'youtube' | 'x' | 'tiktok' }))}
              />
            </div>
          </section>

          {/* Voice */}
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Voice</h2>
            <div style={rowStyle}>
              <Select
                label="Voice Mode"
                value={formData.voiceMode}
                options={[
                  { value: 'preset', label: 'Preset Voice' },
                  { value: 'clone', label: 'Voice Clone (M2)' },
                ]}
                onChange={(v) => setFormData(prev => ({ ...prev, voiceMode: v as 'preset' | 'clone' }))}
                disabled={!!projectId}
              />
              {formData.voiceMode === 'preset' && (
                <Select
                  label={loadingVoices ? 'Voice (Loading...)' : `Voice (${availableVoices.length} available)`}
                  value={formData.voiceId}
                  options={availableVoices.map(v => ({
                    value: v.voice_id,
                    label: `${v.name} (${v.source})`,
                  }))}
                  onChange={(v) => setFormData(prev => ({ ...prev, voiceId: v }))}
                  disabled={loadingVoices}
                />
              )}
            </div>

            {/* Voice Recorder - shown when clone mode is selected (not available for project runs) */}
            {formData.voiceMode === 'clone' && !projectId && (
              <div style={{ marginTop: 'var(--space-md)' }}>
                <VoiceRecorder
                  onRecordingComplete={(base64) => {
                    setFormData(prev => ({ ...prev, voiceSample: base64 }));
                  }}
                />
                {formData.voiceSample && (
                  <p style={{ marginTop: 'var(--space-sm)', fontSize: 'var(--text-sm)', color: 'var(--color-success)' }}>
                    Voice sample recorded and ready
                  </p>
                )}
              </div>
            )}
            {/* Voice clone hint for project mode */}
            {formData.voiceMode === 'clone' && projectId && (
              <p style={{ marginTop: 'var(--space-sm)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                Voice cloning is not available for project runs. Please use a preset voice.
              </p>
            )}
          </section>

          {/* BGM */}
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Background Music</h2>
            <div style={rowStyle}>
              <Select
                label="Music Style"
                value={formData.bgmPreset}
                options={[
                  { value: 'upbeat', label: 'Upbeat' },
                  { value: 'calm', label: 'Calm' },
                  { value: 'energetic', label: 'Energetic' },
                  { value: 'minimal', label: 'Minimal' },
                ]}
                onChange={(v) => setFormData(prev => ({ ...prev, bgmPreset: v }))}
              />
              <Slider
                label="Music Volume"
                min={0}
                max={100}
                value={formData.bgmVolume}
                onChange={(v) => setFormData(prev => ({ ...prev, bgmVolume: v }))}
              />
            </div>
          </section>

          {/* Image Style */}
          <section style={sectionStyle}>
            <h2 style={sectionTitleStyle}>Image Style</h2>
            <div style={rowStyle}>
              <Select
                label="Image Style"
                value={formData.imagePromptStyle}
                options={[
                  { value: 'none', label: 'Default (AI style)' },
                  { value: 'flat-illustration', label: 'Flat Vector Illustration' },
                  { value: 'tech-dashboard', label: 'Tech Dashboard' },
                  { value: '3d-render', label: '3D Render' },
                  { value: 'minimal', label: 'Minimal' },
                  { value: 'custom', label: 'Custom' },
                ]}
                onChange={(v) => setFormData(prev => ({ ...prev, imagePromptStyle: v as 'none' | 'flat-illustration' | 'tech-dashboard' | '3d-render' | 'minimal' | 'custom' }))}
              />
            </div>
            {formData.imagePromptStyle === 'custom' && (
              <div style={{ marginTop: 'var(--space-md)' }}>
                <label style={{ fontSize: 'var(--text-sm)', fontWeight: 700, display: 'block', marginBottom: 'var(--space-sm)' }}>
                  Custom Image Prompt
                </label>
                <textarea
                  style={{
                    width: '100%',
                    minHeight: '120px',
                    padding: 'var(--space-sm)',
                    fontSize: 'var(--text-sm)',
                    fontFamily: 'monospace',
                    border: 'var(--border-width) solid var(--color-border)',
                    resize: 'vertical',
                  }}
                  placeholder="Enter custom image prompt prefix to apply to all generated images..."
                  value={formData.customImagePrompt}
                  onChange={(e) => setFormData(prev => ({ ...prev, customImagePrompt: e.target.value }))}
                />
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-xs)' }}>
                  This prompt will be prepended to each scene's visual prompt to guide the image generation style.
                </p>
              </div>
            )}
          </section>

          {/* Error */}
          {error && (
            <Card style={{ background: '#fff5f5', borderColor: 'var(--color-error)' }}>
              <p style={{ color: 'var(--color-error)' }}>{error}</p>
            </Card>
          )}

          {/* Submit */}
          <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end' }}>
            <Button variant="outline" onClick={() => router.push('/')}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Generate Video'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CreatePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CreateForm />
    </Suspense>
  );
}
