import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Run, addLog, updateRunStatus, saveArtifact } from '../run-manager';
import { chatCompletionJSON } from '../minimax';

interface StoryboardScene {
  id: string;
  sceneNumber: number;
  durationSec: number;
  narrationText: string;
  visualPrompt: string;
  transition: 'fade' | 'slide' | 'wipe' | 'cut';
}

interface Storyboard {
  scenes: StoryboardScene[];
  totalDurationSec: number;
}

const STORYBOARD_PROMPT = `You are a professional storyboard writer. Generate a scene breakdown for a promotional video.

## Input

You will receive a narration script. Break it down into scenes suitable for video.

## Output Schema

Your storyboard MUST be a JSON object with this exact structure:

{
  "scenes": [
    {
      "sceneNumber": 1,
      "durationSec": 10,
      "narrationText": "Exact text from script for this scene",
      "visualPrompt": "Description of visual to generate (for AI image generation)",
      "transition": "fade|slide|wipe|cut"
    }
  ],
  "totalDurationSec": 60
}

## Requirements

1. Scene duration should be 8-15 seconds each
2. Total duration should be {{DURATION}} seconds (with 10% tolerance)
3. Include clear on-screen text for each scene
4. visualPrompt should be descriptive and suitable for AI image generation (e.g., "A modern dashboard UI with charts and data visualizations")
5. Transitions should vary naturally: fade, slide, or cut
6. narrationText should be exact excerpts from the provided script
7. Output ONLY valid JSON, no markdown formatting`;

// Concise prompt for retry
const STORYBOARD_PROMPT_CONCISE = `You are a storyboard writer. Break this script into video scenes.

Output valid JSON:
{"scenes": [{"sceneNumber": 1, "durationSec": 10, "narrationText": "text", "visualPrompt": "description", "transition": "fade"}], "totalDurationSec": 60}

Create 4-5 scenes. Keep text brief. Output JSON only.`;

/**
 * STORYBOARD stage: Generate scene breakdown
 */
export async function runStoryboardStage(run: Run): Promise<void> {
  const { id: runId, version, config, baseDir } = run as Run & { baseDir?: string };

  await addLog(runId, 'INFO', 'STORYBOARD', 'Starting storyboard generation...', baseDir);
  await updateRunStatus(runId, { stageProgress: 10 }, baseDir);

  const RUNS_DIR = baseDir || path.join(process.cwd(), 'runs');
  const runsDir = path.join(RUNS_DIR, runId);

  // Read script from previous stage
  let script = '';

  try {
    const scriptPath = path.join(runsDir, `script_v${version}.md`);
    script = await fs.readFile(scriptPath, 'utf-8');
    await addLog(runId, 'INFO', 'STORYBOARD', `Loaded script: ${script.length} characters`);
  } catch (e) {
    await addLog(runId, 'ERROR', 'STORYBOARD', 'script.md not found');
    throw new Error('Script stage must complete before storyboard generation');
  }

  await updateRunStatus(runId, { stageProgress: 30 });

  // Target duration from config
  const targetDuration = config.duration || 60;

  // Build prompt
  const prompt = STORYBOARD_PROMPT.replace(/\{\{DURATION\}\}/g, String(targetDuration));

  const userMessage = `## Narration Script

${script}

Please break this script down into video scenes. Ensure total duration is approximately ${targetDuration} seconds.`;

  await addLog(runId, 'INFO', 'STORYBOARD', 'Calling MiniMax API for storyboard generation...');

  let storyboard: Storyboard | null = null;
  let lastError: string | null = null;

  // Try with full prompt first, then concise prompt on failure
  const prompts = [
    { prompt: prompt, maxTokens: 4096 },
    { prompt: STORYBOARD_PROMPT_CONCISE, maxTokens: 8192 },
  ];

  for (let attempt = 0; attempt < prompts.length; attempt++) {
    const { prompt: attemptPrompt, maxTokens } = prompts[attempt];

    try {
      await addLog(runId, 'INFO', 'STORYBOARD', `Attempt ${attempt + 1}: Calling MiniMax API...`);

      storyboard = await chatCompletionJSON<Storyboard>(
        [
          { role: 'system', content: attemptPrompt },
          { role: 'user', content: userMessage },
        ],
        {
          temperature: 0.7,
          max_tokens: maxTokens,
        }
      );

      // Validate storyboard
      if (!storyboard.scenes || storyboard.scenes.length === 0) {
        throw new Error('Invalid storyboard: no scenes');
      }

      // Ensure scene numbers are correct and add IDs
      storyboard.scenes = storyboard.scenes.map((scene, index) => ({
        ...scene,
        id: uuidv4(),
        sceneNumber: index + 1,
      }));

      await addLog(runId, 'INFO', 'STORYBOARD', `Attempt ${attempt + 1} succeeded`);
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await addLog(runId, 'WARN', 'STORYBOARD', `Attempt ${attempt + 1} failed: ${lastError}`);

      if (attempt < prompts.length - 1 && lastError.includes('parse')) {
        continue;
      }
    }
  }

  if (!storyboard) {
    await addLog(runId, 'ERROR', 'STORYBOARD', `MiniMax API failed after all retries: ${lastError}`);

    // Fallback to placeholder
    const fallbackStoryboard: Storyboard = {
      scenes: [
        {
          id: uuidv4(),
          sceneNumber: 1,
          durationSec: 10,
          narrationText: 'Welcome to this amazing project.',
          visualPrompt: 'A modern software project interface',
          transition: 'fade',
        },
        {
          id: uuidv4(),
          sceneNumber: 2,
          durationSec: 10,
          narrationText: 'It provides incredible capabilities for developers.',
          visualPrompt: 'Code editor with syntax highlighting',
          transition: 'slide',
        },
        {
          id: uuidv4(),
          sceneNumber: 3,
          durationSec: 10,
          narrationText: 'Get started today and experience the difference.',
          visualPrompt: 'Download and install icon',
          transition: 'fade',
        },
      ],
      totalDurationSec: 30,
    };

    await saveArtifact(runId, `storyboard_v${version}.json`, JSON.stringify(fallbackStoryboard, null, 2));
    throw new Error(`MiniMax API failed: ${lastError}`);
  }

  // Calculate actual duration
  const actualDuration = storyboard.scenes.reduce((sum, s) => sum + (s.durationSec || 0), 0);
  storyboard.totalDurationSec = actualDuration;

  await updateRunStatus(runId, { stageProgress: 80 });

  // Save storyboard artifact
  await saveArtifact(runId, `storyboard_v${version}.json`, JSON.stringify(storyboard, null, 2));

  await addLog(runId, 'INFO', 'STORYBOARD', `Storyboard generated: ${storyboard.scenes.length} scenes, ${actualDuration}s total`);

  await updateRunStatus(runId, { stageProgress: 100 });
}
