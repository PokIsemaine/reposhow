'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Input, Textarea, Card } from '../../components/ui';

export default function NewProjectPage() {
  const router = useRouter();

  const [formData, setFormData] = useState({
    repoUrl: '',
    name: '',
    description: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Extract owner/repo from GitHub URL
  const extractRepoInfo = (url: string): { owner: string; repo: string } | null => {
    const cleanUrl = url.trim().replace(/\/+$/, '');
    const patterns = [
      /(?:www\.)?github\.com\/([^\/]+)\/([^\/\s]+)/,
      /^([^\/]+)\/([^\/\s]+)$/,
    ];
    for (const pattern of patterns) {
      const match = cleanUrl.match(pattern);
      if (match && match[1] && match[2]) {
        const repo = match[2].replace(/\.git$/, '');
        return { owner: match[1], repo };
      }
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate repo URL
    if (!formData.repoUrl.trim()) {
      setError('Please enter a GitHub repository URL');
      return;
    }

    const repoInfo = extractRepoInfo(formData.repoUrl);
    if (!repoInfo) {
      setError('Invalid GitHub URL. Use format: https://github.com/owner/repo');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create project');
      }

      const { project } = await response.json();
      router.push(`/projects/${project.id}`);
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
    maxWidth: '600px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-xl)',
  };

  const repoInfo = extractRepoInfo(formData.repoUrl);

  return (
    <div style={containerStyle}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <Link href="/projects" style={{ display: 'inline-block', marginBottom: 'var(--space-md)', color: 'var(--color-primary)', textDecoration: 'underline' }}>
          ← Back to Projects
        </Link>

        <h1 style={{ marginBottom: 'var(--space-lg)' }}>New Project</h1>

        <form onSubmit={handleSubmit} style={formStyle}>
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <Input
                label="GitHub Repository URL *"
                placeholder="https://github.com/owner/repo"
                value={formData.repoUrl}
                onChange={(e) => setFormData(prev => ({ ...prev, repoUrl: e.target.value }))}
              />
              {formData.repoUrl && repoInfo && (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-success)' }}>
                  Extracted: {repoInfo.owner}/{repoInfo.repo}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <Input
                label="Project Name (optional)"
                placeholder={repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : 'Enter project name'}
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
              <Textarea
                label="Description (optional)"
                placeholder="Brief description of this project"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                style={{ minHeight: '80px' }}
              />
            </div>
          </Card>

          {/* Error */}
          {error && (
            <Card style={{ background: '#fff5f5', borderColor: 'var(--color-error)' }}>
              <p style={{ color: 'var(--color-error)' }}>{error}</p>
            </Card>
          )}

          {/* Submit */}
          <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end' }}>
            <Button variant="outline" onClick={() => router.push('/projects')}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Project'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
