import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getProject, getProjectRunsDir, getProjectDir } from '@/lib/project-manager';
import { getRunStatus } from '@/lib/run-manager';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  try {
    const { id: projectId, runId } = await params;

    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const runsDir = getProjectRunsDir(projectId);
    const runDir = path.join(runsDir, runId);

    // Check if run exists by checking if status.json exists
    const status = await getRunStatus(runId, runsDir);
    if (!status) {
      return NextResponse.json(
        { error: 'Run not found' },
        { status: 404 }
      );
    }

    // Delete the run directory
    await fs.rm(runDir, { recursive: true, force: true });

    // Update project's runCount
    const projectDir = getProjectDir(projectId);
    const projectJsonPath = path.join(projectDir, 'project.json');
    const projectContent = await fs.readFile(projectJsonPath, 'utf-8');
    const projectData = JSON.parse(projectContent);

    const updatedProject = {
      ...projectData,
      runCount: Math.max(0, (projectData.runCount || 1) - 1),
      latestRunId: projectData.latestRunId === runId ? null : projectData.latestRunId,
      updatedAt: new Date().toISOString(),
    };

    await fs.writeFile(projectJsonPath, JSON.stringify(updatedProject, null, 2));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting run:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
