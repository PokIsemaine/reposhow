import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { findRun, getRunFilePath } from '@/lib/run-manager';
import { retryRun } from '@/lib/pipeline';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Find the run (supports both top-level and project runs)
    const found = await findRun(id);
    if (!found) {
      return NextResponse.json(
        { error: 'Run not found' },
        { status: 404 }
      );
    }

    const { baseDir, run: existingRun } = found;

    // Extract projectId if run is in a project
    const projectId = baseDir.includes('projects') ? baseDir.split(path.sep).slice(-2, -1)[0] : undefined;

    // Check if new config is provided in request body
    let body: { config?: Record<string, unknown> } | null = null;
    try {
      body = await request.json();
    } catch {
      // No body provided, use existing config
    }

    // If new config is provided, update run.json first
    if (body?.config && existingRun) {
      const updatedConfig = {
        ...existingRun.config,
        ...body.config,
      };

      const updatedRun = {
        ...existingRun,
        config: updatedConfig,
      };

      await fs.writeFile(
        getRunFilePath(id, 'run.json', baseDir),
        JSON.stringify(updatedRun, null, 2)
      );
    }

    await retryRun(id, projectId);

    return NextResponse.json({ success: true, runId: id });
  } catch (error) {
    console.error('Error retrying run:', error);

    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
