'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card } from '../../components/ui';

interface RunStatus {
  runId: string;
  stage: string;
  overallProgress: number;
  config: {
    repoUrl?: string;
    localPath?: string;
    duration: number;
    resolution: string;
  };
}

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMoreDownloads, setShowMoreDownloads] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/runs/${id}/status`);
        if (!response.ok) {
          throw new Error('Failed to fetch status');
        }
        const data = await response.json();
        setStatus(data);
      } catch (err) {
        console.error('Error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, [id]);

  const downloadFile = async (file: string) => {
    window.open(`/api/runs/${id}/download?file=${file}`, '_blank');
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        Loading...
      </div>
    );
  }

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    padding: 'var(--space-xl) var(--space-md)',
  };

  const headerStyle: React.CSSProperties = {
    maxWidth: '1000px',
    margin: '0 auto var(--space-xl)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-md)',
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={{ margin: 0 }}>Video Ready</h1>
        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
          <Link href="/projects">
            <Button variant="outline">Projects</Button>
          </Link>
          <Button onClick={() => router.push('/')}>New Video</Button>
        </div>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
        {/* Video Player */}
        <Card>
          <h2 style={{ marginBottom: 'var(--space-md)' }}>Your Video</h2>

          {/* Video Display */}
          <div style={{
            width: '100%',
            aspectRatio: '16/9',
            background: 'var(--color-bg-alt)',
            border: 'var(--border-width) solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 'var(--space-md)',
          }}>
            <video
              controls
              style={{ maxWidth: '100%', maxHeight: '100%' }}
              src={`/api/runs/${id}/download?file=mp4`}
            >
              Your browser does not support video playback.
            </video>
          </div>

          {/* Download Buttons - Collapsible */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {/* Main Download Button */}
            <Button onClick={() => downloadFile('mp4')} style={{ padding: 'var(--space-md) var(--space-xl)', fontSize: 'var(--text-lg)' }}>
              Download Video
            </Button>

            {/* Toggle for More Options */}
            <button
              onClick={() => setShowMoreDownloads(!showMoreDownloads)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-xs)',
                padding: 'var(--space-xs) 0',
                alignSelf: 'flex-start',
              }}
            >
              {showMoreDownloads ? '▼' : '▶'} More download options
            </button>

            {/* Collapsible Additional Downloads */}
            {showMoreDownloads && (
              <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap', paddingTop: 'var(--space-sm)' }}>
                <Button variant="outline" size="sm" onClick={() => downloadFile('srt')}>
                  Subtitles (.srt)
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadFile('script')}>
                  Script (.md)
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadFile('storyboard')}>
                  Storyboard (.json)
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadFile('analysis')}>
                  Analysis (.json)
                </Button>
              </div>
            )}

            {/* Video Details */}
            <div style={{ marginTop: 'var(--space-lg)', paddingTop: 'var(--space-md)', borderTop: 'var(--border-width) solid var(--color-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                <h3 style={{ margin: 0, fontSize: 'var(--text-md)' }}>Video Details</h3>
                <Button variant="outline" size="sm" onClick={() => router.push(`/storyboard/${id}`)}>
                  View Storyboard
                </Button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-md)', fontSize: 'var(--text-sm)' }}>
                <div>
                  <div style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Repository</div>
                  <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{status?.config?.repoUrl || status?.config?.localPath || 'N/A'}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Duration</div>
                  <div style={{ fontWeight: 600 }}>{status?.config?.duration}s</div>
                </div>
                <div>
                  <div style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-xs)' }}>Resolution</div>
                  <div style={{ fontWeight: 600 }}>{status?.config?.resolution}</div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
