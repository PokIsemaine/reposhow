'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, Input, Textarea, Badge } from '../../components/ui';

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

interface Run {
  id: string;
  createdAt: string;
  stage: string;
  stageProgress: number;
  overallProgress: number;
  error: string | null;
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const projectId = resolvedParams.id;

  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Run delete confirmation state
  const [runToDelete, setRunToDelete] = useState<string | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);

  useEffect(() => {
    fetchProject();
    fetchRuns();
  }, [projectId]);

  const fetchProject = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError('Project not found');
          return;
        }
        throw new Error('Failed to fetch project');
      }
      const data = await response.json();
      setProject(data.project);
      setEditData({
        name: data.project.name,
        description: data.project.description || '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const fetchRuns = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/runs`);
      if (!response.ok) {
        throw new Error('Failed to fetch runs');
      }
      const data = await response.json();
      setRuns(data.runs || []);
    } catch (err) {
      console.error('Error fetching runs:', err);
    }
  };

  const handleUpdate = async () => {
    if (!project) return;
    setSaving(true);

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update project');
      }

      const data = await response.json();
      setProject(data.project);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete project');
      }

      router.push('/projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleCreateRun = () => {
    if (project?.repoUrl) {
      router.push(`/create?projectId=${projectId}`);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    setDeletingRun(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/runs/${runId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete run');
      }

      // Refresh the runs list
      fetchRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setDeletingRun(false);
      setRunToDelete(null);
    }
  };

  const getStageVariant = (stage: string): 'default' | 'success' | 'warning' | 'error' => {
    const stageUpper = stage.toUpperCase();
    if (stageUpper === 'COMPLETED' || stageUpper === 'SUCCESS') return 'success';
    if (stageUpper === 'ERROR' || stageUpper === 'FAILED') return 'error';
    if (stageUpper === 'QUEUED' || stageUpper === 'PENDING') return 'default';
    return 'warning';
  };

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    padding: 'var(--space-xl) var(--space-md)',
  };

  const maxWidth = '1000px';

  const headerStyle: React.CSSProperties = {
    maxWidth,
    margin: '0 auto var(--space-xl) auto',
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
          Loading project...
        </div>
      </div>
    );
  }

  if (error && !project) {
    return (
      <div style={containerStyle}>
        <Card style={{ maxWidth, margin: '0 auto', textAlign: 'center' }}>
          <p style={{ color: 'var(--color-error)', marginBottom: 'var(--space-md)' }}>{error}</p>
          <Link href="/projects">
            <Button>Back to Projects</Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (!project) {
    return null;
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <Link href="/projects" style={{ display: 'inline-block', marginBottom: 'var(--space-md)', color: 'var(--color-primary)', textDecoration: 'underline' }}>
          ← Back to Projects
        </Link>
      </div>

      {/* Error message */}
      {error && (
        <Card style={{ maxWidth, margin: '0 auto var(--space-lg) auto', background: '#fff5f5', borderColor: 'var(--color-error)' }}>
          <p style={{ color: 'var(--color-error)' }}>{error}</p>
        </Card>
      )}

      {/* Project Header Card */}
      <Card style={{ maxWidth, margin: '0 auto var(--space-xl) auto' }}>
        {isEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            <Input
              label="Project Name"
              value={editData.name}
              onChange={(e) => setEditData(prev => ({ ...prev, name: e.target.value }))}
            />
            <Textarea
              label="Description"
              value={editData.description}
              onChange={(e) => setEditData(prev => ({ ...prev, description: e.target.value }))}
              style={{ minHeight: '80px' }}
            />
            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => setIsEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-md)' }}>
              <div>
                <h1 style={{ margin: '0 0 var(--space-xs) 0' }}>{project.name}</h1>
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 'var(--text-sm)', color: 'var(--color-primary)' }}
                >
                  {project.repoUrl}
                </a>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                  Delete
                </Button>
              </div>
            </div>
            {project.description && (
              <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-md)' }}>
                {project.description}
              </p>
            )}
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              Created: {formatDate(project.createdAt)} | Updated: {formatDate(project.updatedAt)}
            </div>
          </>
        )}
      </Card>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
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
          <Card style={{ maxWidth: '400px', margin: 'var(--space-md)' }}>
            <h2 style={{ marginTop: 0 }}>Delete Project?</h2>
            <p style={{ marginBottom: 'var(--space-lg)' }}>
              This will permanently delete the project and all its runs. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button onClick={handleDelete} disabled={deleting} style={{ background: 'var(--color-error)', color: 'white' }}>
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Run Delete Confirmation Modal */}
      {runToDelete && (
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
          <Card style={{ maxWidth: '400px', margin: 'var(--space-md)' }}>
            <h2 style={{ marginTop: 0 }}>Delete Run?</h2>
            <p style={{ marginBottom: 'var(--space-lg)' }}>
              This will permanently delete this run and all its artifacts. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => setRunToDelete(null)} disabled={deletingRun}>
                Cancel
              </Button>
              <Button onClick={() => handleDeleteRun(runToDelete)} disabled={deletingRun} style={{ background: 'var(--color-error)', color: 'white' }}>
                {deletingRun ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Runs Section */}
      <Card style={{ maxWidth, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
          <h2 style={{ margin: 0 }}>Runs</h2>
          <Button onClick={handleCreateRun}>
            Create Video
          </Button>
        </div>

        {runs.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: 'var(--space-lg)' }}>
            No runs yet. Click "New Run" to create a video.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {runs.map((run) => (
              <div
                key={run.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'var(--space-md)',
                  border: 'var(--border-width) solid var(--color-border)',
                  borderRadius: 'var(--border-radius)',
                  background: 'var(--color-bg)',
                }}
              >
                <Link
                  href={`/run/${run.id}?from=projects`}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-md)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <span style={{ fontFamily: 'monospace', fontSize: 'var(--text-sm)' }}>
                    {run.id.substring(0, 8)}...
                  </span>
                  <Badge variant={getStageVariant(run.stage)}>
                    {run.stage}
                  </Badge>
                  <div style={{ flex: 1, maxWidth: '150px' }}>
                    <div style={{
                      height: '4px',
                      background: 'var(--color-border)',
                      borderRadius: '2px',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${run.overallProgress}%`,
                        background: run.stage === 'ERROR' ? 'var(--color-error)' : 'var(--color-success)',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                      {run.overallProgress}%
                    </span>
                  </div>
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    {formatDate(run.createdAt)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      setRunToDelete(run.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
