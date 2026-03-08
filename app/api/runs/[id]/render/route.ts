import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { findRun, getRunStatus } from '@/lib/run-manager';
import { startRender } from '@/lib/pipeline';

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

    const { baseDir } = found;

    const status = await getRunStatus(id, baseDir);

    if (!status) {
      return NextResponse.json(
        { error: 'Run not found' },
        { status: 404 }
      );
    }

    if (status.stage !== 'ASSETS_COMPLETE') {
      return NextResponse.json(
        { error: 'Run must have assets generated first' },
        { status: 400 }
      );
    }

    // Start rendering
    const projectId = baseDir?.includes('projects') ? baseDir.split(path.sep).slice(-2, -1)[0] : undefined;
    await startRender(id, projectId);

    return NextResponse.json({
      success: true,
      nextStage: 'RENDER',
    });
  } catch (error) {
    console.error('Error starting render:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
