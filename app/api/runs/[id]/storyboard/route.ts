import { NextRequest, NextResponse } from 'next/server';
import { getRun, getRunStatus, findRun, getRunDir } from '@/lib/run-manager';
import { promises as fs } from 'fs';
import path from 'path';

export async function GET(
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

    const [run, status] = await Promise.all([
      getRun(id, baseDir),
      getRunStatus(id, baseDir),
    ]);

    if (!run || !status) {
      return NextResponse.json(
        { error: 'Run not found' },
        { status: 404 }
      );
    }

    const runsDir = getRunDir(id, baseDir);
    const storyboardPath = path.join(runsDir, `storyboard_v${run.version}.json`);

    try {
      const content = await fs.readFile(storyboardPath, 'utf-8');
      const storyboard = JSON.parse(content);

      return NextResponse.json({
        storyboard,
        version: run.version,
        stage: status.stage,
      });
    } catch {
      return NextResponse.json(
        { error: 'Storyboard not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Error getting storyboard:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    const [run, status] = await Promise.all([
      getRun(id, baseDir),
      getRunStatus(id, baseDir),
    ]);

    if (!run || !status) {
      return NextResponse.json(
        { error: 'Run not found' },
        { status: 404 }
      );
    }

    // Only allow editing in STORYBOARD_REVIEW stage
    if (status.stage !== 'STORYBOARD_REVIEW') {
      return NextResponse.json(
        { error: 'Storyboard can only be edited during review stage' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const runsDir = getRunDir(id, baseDir);
    const storyboardPath = path.join(runsDir, `storyboard_v${run.version}.json`);

    // Read current storyboard
    const content = await fs.readFile(storyboardPath, 'utf-8');
    const storyboard = JSON.parse(content);

    // Apply updates
    if (body.scenes && Array.isArray(body.scenes)) {
      // Update specific scenes
      for (const update of body.scenes) {
        const sceneIndex = storyboard.scenes.findIndex(
          (s: { sceneNumber: number }) => s.sceneNumber === update.sceneNumber
        );
        if (sceneIndex !== -1) {
          // Preserve the id field
          const existingId = storyboard.scenes[sceneIndex].id;
          storyboard.scenes[sceneIndex] = {
            ...storyboard.scenes[sceneIndex],
            ...update,
            id: existingId,
          };
        }
      }

      // Recalculate total duration
      storyboard.totalDurationSec = storyboard.scenes.reduce(
        (sum: number, s: { durationSec: number }) => sum + (s.durationSec || 0),
        0
      );
    }

    // Save updated storyboard
    await fs.writeFile(storyboardPath, JSON.stringify(storyboard, null, 2));

    return NextResponse.json({
      storyboard,
      version: run.version,
    });
  } catch (error) {
    console.error('Error updating storyboard:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
