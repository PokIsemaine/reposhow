'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card } from '../components/ui';

interface Project {
  id: string;
  name: string;
  repoUrl: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  latestRunId?: string;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) {
        throw new Error('Failed to fetch projects');
      }
      const data = await response.json();
      setProjects(data.projects || []);
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

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-xl)',
    maxWidth: '1200px',
    margin: '0 auto var(--space-xl) auto',
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
  };

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 'var(--space-lg)',
    maxWidth: '1200px',
    margin: '0 auto',
  };

  const cardTitleStyle: React.CSSProperties = {
    margin: '0 0 var(--space-sm) 0',
    fontSize: 'var(--text-lg)',
  };

  const cardMetaStyle: React.CSSProperties = {
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-secondary)',
    marginBottom: 'var(--space-sm)',
  };

  const cardDescStyle: React.CSSProperties = {
    fontSize: 'var(--text-sm)',
    marginBottom: 'var(--space-md)',
  };

  const cardFooterStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 'var(--space-md)',
    paddingTop: 'var(--space-md)',
    borderTop: 'var(--border-width) solid var(--color-border)',
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
          Loading projects...
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>Projects</h1>
        <Button onClick={() => router.push('/projects/new')}>
          New Project
        </Button>
      </header>

      {error && (
        <Card style={{ maxWidth: '1200px', margin: '0 auto var(--space-lg) auto', background: '#fff5f5', borderColor: 'var(--color-error)' }}>
          <p style={{ color: 'var(--color-error)' }}>{error}</p>
        </Card>
      )}

      {projects.length === 0 ? (
        <Card style={{ maxWidth: '1200px', margin: '0 auto', textAlign: 'center' }}>
          <p style={{ marginBottom: 'var(--space-md)' }}>No projects yet.</p>
          <Button onClick={() => router.push('/projects/new')}>
            Create Your First Project
          </Button>
        </Card>
      ) : (
        <div style={gridStyle}>
          {projects.map((project) => (
            <Card key={project.id} style={{ display: 'flex', flexDirection: 'column' }}>
              <h2 style={cardTitleStyle}>{project.name}</h2>
              <p style={cardMetaStyle}>
                {project.repoUrl}
              </p>
              {project.description && (
                <p style={cardDescStyle}>{project.description}</p>
              )}
              <div style={cardFooterStyle}>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  {project.runCount} run{project.runCount !== 1 ? 's' : ''}
                </span>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  Updated {formatDate(project.updatedAt)}
                </span>
              </div>
              <div style={{ marginTop: 'auto' }}>
                <Link href={`/projects/${project.id}`}>
                  <Button variant="outline" style={{ width: '100%' }}>
                    View Project
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
