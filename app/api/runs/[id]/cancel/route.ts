import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { findRun } from '@/lib/run-manager';
import { cancelRun } from '@/lib/pipeline';

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

    // Extract projectId if run is in a project
    const projectId = baseDir.includes('projects') ? baseDir.split(path.sep).slice(-2, -1)[0] : undefined;

    await cancelRun(id, projectId);

    return NextResponse.json({ success: true, runId: id });
  } catch (error) {
    console.error('Error cancelling run:', error);

    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 }
    );
  }
}
