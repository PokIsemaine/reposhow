'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Card } from './components/ui';
import { Modal } from './components/ui/Modal';

export default function Landing() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [existingProject, setExistingProject] = useState<{ id: string; name: string } | null>(null);
  const [showExistingModal, setShowExistingModal] = useState(false);

  // Validate GitHub URL
  const validateUrl = (url: string): boolean => {
    // Remove trailing slash and .git suffix
    const cleaned = url.replace(/\/$/, '').replace(/\.git$/, '');
    // Match github.com/owner/repo pattern
    const pattern = /^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/?$/;
    return pattern.test(cleaned);
  };

  // Check if repo already exists in a project
  const checkExistingProject = async (url: string): Promise<{ id: string; name: string } | null> => {
    if (!url.trim() || !validateUrl(url)) {
      return null;
    }

    try {
      const response = await fetch(`/api/projects?repoUrl=${encodeURIComponent(url)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.project) {
          return { id: data.project.id, name: data.project.name };
        }
      }
    } catch (err) {
      console.error('Error checking existing project:', err);
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setExistingProject(null);

    if (!repoUrl.trim()) {
      setError('Please enter a GitHub repository URL');
      return;
    }

    if (!validateUrl(repoUrl)) {
      setError('Invalid GitHub URL. Use format: https://github.com/owner/repo');
      return;
    }

    setLoading(true);

    // Check for existing project
    const existing = await checkExistingProject(repoUrl);

    if (existing) {
      setExistingProject(existing);
      setShowExistingModal(true);
      setLoading(false);
      return;
    }

    // Clean and redirect to create page
    const cleaned = repoUrl.replace(/\/$/, '').replace(/\.git$/, '');
    router.push(`/create?repo=${encodeURIComponent(cleaned)}`);
  };

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 'var(--space-md) var(--space-lg)',
    borderBottom: 'var(--border-width) solid var(--color-border)',
  };

  const logoStyle: React.CSSProperties = {
    fontSize: 'var(--text-xl)',
    fontWeight: 700,
  };

  const heroStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-3xl) var(--space-md)',
    textAlign: 'center',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 'var(--text-4xl)',
    marginBottom: 'var(--space-md)',
    maxWidth: '800px',
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: 'var(--text-lg)',
    color: 'var(--color-text-muted)',
    marginBottom: 'var(--space-xl)',
    maxWidth: '600px',
  };

  const formStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: '600px',
    display: 'flex',
    gap: 'var(--space-sm)',
  };

  const inputWrapperStyle: React.CSSProperties = {
    flex: 1,
  };

  const howItWorksStyle: React.CSSProperties = {
    padding: 'var(--space-3xl) var(--space-lg)',
    background: 'var(--color-bg-alt)',
    borderTop: 'var(--border-width) solid var(--color-border)',
  };

  const sectionTitleStyle: React.CSSProperties = {
    textAlign: 'center',
    marginBottom: 'var(--space-xl)',
    fontSize: 'var(--text-2xl)',
  };

  const stepsGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 'var(--space-lg)',
    maxWidth: '1000px',
    margin: '0 auto',
  };

  const featuresStyle: React.CSSProperties = {
    padding: 'var(--space-3xl) var(--space-lg)',
    background: 'var(--color-bg-alt)',
    borderTop: 'var(--border-width) solid var(--color-border)',
  };

  const featuresGridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 'var(--space-md)',
    maxWidth: '800px',
    margin: '0 auto',
  };

  const featureCardStyle: React.CSSProperties = {
    padding: 'var(--space-md)',
    border: 'var(--border-width) solid var(--color-border)',
    background: 'var(--color-bg)',
    boxShadow: 'var(--shadow-sm)',
    textAlign: 'center',
  };

  const footerStyle: React.CSSProperties = {
    padding: 'var(--space-lg)',
    borderTop: 'var(--border-width) solid var(--color-border)',
    textAlign: 'center',
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-muted)',
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <header style={headerStyle}>
        <div style={logoStyle}>RepoShow</div>
        <div>
          <Button variant="ghost">Docs</Button>
        </div>
      </header>

      {/* Hero */}
      <section style={heroStyle}>
        <h1 style={titleStyle}>Turn any GitHub repo into a promo video.</h1>
        <p style={subtitleStyle}>
          RepoShow is a repo-aware AI system that turns a GitHub repository into a short promotional video.
        </p>

        <form onSubmit={handleSubmit} style={formStyle}>
          <div style={inputWrapperStyle}>
            <Input
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              error={error}
              style={{ width: '100%' }}
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? 'Processing...' : 'Generate'}
          </Button>
        </form>
      </section>

      {/* Existing Project Modal */}
      <Modal
        isOpen={showExistingModal}
        onClose={() => setShowExistingModal(false)}
        title="Project Already Exists"
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowExistingModal(false)}>
              Cancel
            </Button>
            <Button onClick={() => router.push(`/projects/${existingProject?.id}`)}>
              View Project
            </Button>
          </>
        }
      >
        <p>
          This repository already has a project: <strong>{existingProject?.name}</strong>
        </p>
        <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-sm)' }}>
          Would you like to view the existing project or create a new one?
        </p>
      </Modal>

      {/* How it works */}
      <section style={howItWorksStyle}>
        <h2 style={sectionTitleStyle}>How it works</h2>
        <div style={stepsGridStyle}>
          <Card>
            <div style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-sm)' }}>1</div>
            <h3>Paste Repo</h3>
            <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-sm)', fontSize: 'var(--text-sm)' }}>
              Enter any public GitHub repository URL
            </p>
          </Card>
          <Card>
            <div style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-sm)' }}>2</div>
            <h3>AI Analysis</h3>
            <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-sm)', fontSize: 'var(--text-sm)' }}>
              Code-aware repo analysis, script & storyboard generation
            </p>
          </Card>
          <Card>
            <div style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-sm)' }}>3</div>
            <h3>Get Video</h3>
            <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-sm)', fontSize: 'var(--text-sm)' }}>
              Remotion code-based rendering to MP4
            </p>
          </Card>
        </div>
      </section>

      {/* Features */}
      <section style={featuresStyle}>
        <h2 style={{ ...sectionTitleStyle, marginBottom: 'var(--space-lg)' }}>Key Features</h2>
        <div style={featuresGridStyle}>
          <div style={featureCardStyle}>
            <h4>Code Analysis</h4>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              Powered by MiniMax M2.5
            </p>
          </div>
          <div style={featureCardStyle}>
            <h4>Auto Audio</h4>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              ElevenLabs TTS + BGM
            </p>
          </div>
          <div style={featureCardStyle}>
            <h4>AI Images</h4>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              banana (Nano Banana)
            </p>
          </div>
          <div style={featureCardStyle}>
            <h4>HD Output</h4>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              Remotion rendering
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={footerStyle}>
        <p>Run locally: Clone this repo and run `npm run dev`</p>
        <p style={{ marginTop: 'var(--space-xs)' }}>
          Demo purposes only. Generated videos are for personal use.
        </p>
      </footer>
    </div>
  );
}
