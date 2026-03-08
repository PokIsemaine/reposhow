import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  getProject,
  getProjectRuns,
  getProjectRunsDir,
  getProjectDir,
} from '@/lib/project-manager';
import { Run, RunStatus, getRunStatus } from '@/lib/run-manager';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;

    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const runs = await getProjectRuns(projectId);

    // Fetch status for each run
    const runsDir = getProjectRunsDir(projectId);
    const runsWithStatus = await Promise.all(
      runs.map(async (run) => {
        const status = await getRunStatus(run.id, runsDir);
        return {
          ...run,
          stage: status?.stage || 'UNKNOWN',
          stageProgress: status?.stageProgress || 0,
          overallProgress: status?.overallProgress || 0,
          error: status?.error || null,
        };
      })
    );

    return NextResponse.json({ runs: runsWithStatus });
  } catch (error) {
    console.error('Error getting project runs:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;

    const project = await getProject(projectId);
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    const body = await request.json();

    // Create run within the project
    const runId = uuidv4();
    const runsDir = getProjectRunsDir(projectId);
    const runDir = path.join(runsDir, runId);
    const projectRepoDir = path.join(getProjectDir(projectId), 'repo');

    // Create run directory structure
    await fs.mkdir(runDir, { recursive: true });
    await fs.mkdir(path.join(runDir, 'assets'), { recursive: true });
    await fs.mkdir(path.join(runDir, 'audio'), { recursive: true });
    // Ensure shared repo directory exists
    await fs.mkdir(projectRepoDir, { recursive: true });

    // Create run.json
    const run: Run = {
      id: runId,
      version: 1,
      createdAt: new Date().toISOString(),
      config: {
        repoUrl: project.repoUrl,
        localPath: projectRepoDir,
        instructions: body.instructions || '',
        duration: body.duration || 60,
        resolution: body.resolution || 'youtube',
        voiceMode: body.voiceMode || 'preset',
        voiceId: body.voiceId || 'rachel',
        bgmPreset: body.bgmPreset || 'upbeat',
        bgmVolume: body.bgmVolume ?? 30,
        imagePromptStyle: body.imagePromptStyle || 'none',
        customImagePrompt: body.customImagePrompt || '',
      },
    };

    await fs.writeFile(
      path.join(runDir, 'run.json'),
      JSON.stringify(run, null, 2)
    );

    // Create initial status.json
    const status: RunStatus = {
      stage: 'QUEUED',
      stageProgress: 0,
      overallProgress: 0,
      artifacts: {},
      stageTimings: {} as Record<string, { startedAt?: string; completedAt?: string }>,
      updatedAt: new Date().toISOString(),
    };

    await fs.writeFile(
      path.join(runDir, 'status.json'),
      JSON.stringify(status, null, 2)
    );

    // Create empty logs file
    await fs.writeFile(path.join(runDir, 'logs.jsonl'), '');

    // Execute pipeline asynchronously
    const { executePipeline } = await import('@/lib/pipeline');
    executePipeline(runId, projectId).catch(error => {
      console.error(`Pipeline failed for run ${runId}:`, error);
    });

    return NextResponse.json({ runId }, { status: 201 });
  } catch (error) {
    console.error('Error creating project run:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
