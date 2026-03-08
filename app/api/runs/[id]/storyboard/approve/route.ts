import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { getRunStatus, findRun, getRunFilePath } from '@/lib/run-manager';
import { approveStoryboard } from '@/lib/pipeline';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { bgmMusicId, imagePromptStyle, customImagePrompt } = body;

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

    if (status.stage !== 'STORYBOARD_REVIEW') {
      return NextResponse.json(
        { error: 'Storyboard must be in review stage to approve' },
        { status: 400 }
      );
    }

    // Update run config with BGM selection if provided
    if (bgmMusicId || imagePromptStyle) {
      try {
        const runFilePath = getRunFilePath(id, 'run.json', baseDir);
        const runContent = await fs.readFile(runFilePath, 'utf-8');
        const runData = JSON.parse(runContent);
        runData.config = runData.config || {};
        if (bgmMusicId) {
          runData.config.bgmPreset = bgmMusicId;
        }
        if (imagePromptStyle) {
          runData.config.imagePromptStyle = imagePromptStyle;
        }
        if (customImagePrompt) {
          runData.config.customImagePrompt = customImagePrompt;
        }
        await fs.writeFile(runFilePath, JSON.stringify(runData, null, 2));
      } catch (err) {
        console.error('Failed to update run config:', err);
        // Continue anyway - these are optional
      }
    }

    // Approve and continue pipeline (pass projectId if run is in a project)
    const projectId = baseDir.includes('projects') ? baseDir.split(path.sep).slice(-2, -1)[0] : undefined;
    await approveStoryboard(id, projectId);

    return NextResponse.json({
      success: true,
      nextStage: 'ASSETS',
    });
  } catch (error) {
    console.error('Error approving storyboard:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
