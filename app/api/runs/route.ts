import { NextRequest, NextResponse } from 'next/server';
import { startRun } from '@/lib/pipeline';
import { DEFAULTS } from '@/lib/config';
import { cloneVoice } from '@/lib/elevenlabs';
import { findProjectByRepoUrl, createProject, getProjectDir } from '@/lib/project-manager';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    if (!body.repoUrl && !body.localPath) {
      return NextResponse.json(
        { error: 'Either repoUrl or localPath is required' },
        { status: 400 }
      );
    }

    // Handle voice cloning
    let voiceId = body.voiceId || DEFAULTS.voicePreset;
    const voiceMode = body.voiceMode || 'preset';

    if (voiceMode === 'clone') {
      if (!body.voiceSample) {
        return NextResponse.json(
          { error: 'voiceSample is required for voice clone mode' },
          { status: 400 }
        );
      }

      // Clone the voice in real-time
      try {
        voiceId = await cloneVoice(body.voiceSample, 'RepoShow Clone');
      } catch (cloneError) {
        console.error('Voice cloning failed:', cloneError);
        return NextResponse.json(
          { error: 'Failed to clone voice. Please try again.' },
          { status: 500 }
        );
      }
    }

    // Build config with defaults
    const config = {
      repoUrl: body.repoUrl,
      localPath: body.localPath,
      token: body.token || undefined,
      instructions: body.instructions || '',
      duration: body.duration || DEFAULTS.duration,
      resolution: body.resolution || DEFAULTS.resolution,
      voiceMode,
      voiceId,
      voiceSample: undefined, // Don't store the sample after cloning
      bgmPreset: body.bgmPreset || DEFAULTS.bgmPreset,
      bgmVolume: body.bgmVolume ?? DEFAULTS.bgmVolume,
      imagePromptStyle: body.imagePromptStyle || 'none',
      customImagePrompt: body.customImagePrompt || '',
    };

    // Find or create project for this repo
    let projectId: string | undefined;
    if (body.repoUrl) {
      let project = await findProjectByRepoUrl(body.repoUrl);
      if (!project) {
        // Create new project for this repo
        project = await createProject({
          repoUrl: body.repoUrl,
        });
      }
      projectId = project.id;

      // Set localPath to use shared repo directory
      config.localPath = path.join(getProjectDir(projectId), 'repo');
    }

    // Create run and start pipeline (optionally within a project)
    const run = await startRun(config, projectId);

    return NextResponse.json({ runId: run.id, projectId }, { status: 201 });
  } catch (error) {
    console.error('Error creating run:', error);

    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
