import { NextRequest, NextResponse } from 'next/server';
import { findRun, getRunStatus } from '@/lib/run-manager';
import { getEvents } from '@/lib/event-store';

/**
 * GET /api/runs/[id]/events
 * Query historical events for a run
 *
 * Query params:
 * - after: Event ID to get events after (optional)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;
  const { searchParams } = new URL(request.url);
  const afterId = searchParams.get('after');
  const after = afterId ? parseInt(afterId, 10) : undefined;

  // Find the run
  const runResult = await findRun(runId);
  if (!runResult) {
    return NextResponse.json(
      { error: 'Run not found' },
      { status: 404 }
    );
  }

  const { baseDir } = runResult;

  // Get events from event store
  const events = await getEvents(runId, after, baseDir);

  return NextResponse.json({ events });
}
