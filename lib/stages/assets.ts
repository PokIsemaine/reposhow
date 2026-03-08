import fs from 'fs/promises';
import path from 'path';
import { Run, addLog, updateRunStatus, saveArtifact, getRunStatus } from '../run-manager';
import { generateImage } from '../image-gen';
import { generateTTS, generateBGM, getMusicLibrary } from '../elevenlabs';
import { generateMusic, chatCompletion } from '../minimax';
import { DEFAULTS, getConfig, getStyleTemplate } from '../config';
import { getAudioDuration } from '../audio-utils';

/**
 * Process items in batches with limited concurrency
 * Useful for APIs with rate limits (e.g., ElevenLabs: max 2 concurrent)
 */
async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => processor(item, i + batchIndex))
    );
    results.push(...batchResults);
  }

  return results;
}

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

/**
 * Generate content summary from storyboard narration using MiniMax LLM
 * Extracts core theme from video narration to combine with music style
 */
async function generateContentSummary(storyboard: Storyboard): Promise<string> {
  // Collect all narration texts from scenes
  const allNarrations = storyboard.scenes
    .map((scene: StoryboardScene) => scene.narrationText)
    .filter(Boolean)
    .join('\n\n');

  if (!allNarrations.trim()) {
    return 'software project showcase';
  }

  const messages = [
    {
      role: 'system' as const,
      content: '你是一个视频内容分析助手。从视频旁白中提取核心主题，用一句话简洁描述视频内容主题。只需返回一句话，不要多余文字。'
    },
    {
      role: 'user' as const,
      content: `从以下视频旁白中提取核心主题（仅返回一句话主题描述，不要多余文字）：\n\n${allNarrations}`
    }
  ];

  try {
    const response = await chatCompletion(messages, { temperature: 0.3, max_tokens: 200 });
    const summary = response.choices[0]?.message?.content?.trim();
    return summary || 'software project showcase';
  } catch (error) {
    console.error('[Assets] Failed to generate content summary:', error);
    return 'software project showcase';
  }
}

/**
 * ASSETS stage: Generate images, TTS, and BGM in parallel
 */
export async function runAssetsStage(run: Run): Promise<void> {
  const { id: runId, version, baseDir } = run as Run & { baseDir?: string };

  await addLog(runId, 'INFO', 'ASSETS', 'Starting asset generation (parallel mode)...', baseDir);

  // Read storyboard
  const RUNS_DIR = baseDir || path.join(process.cwd(), 'runs');
  const runsDir = path.join(RUNS_DIR, runId);
  let storyboard: Storyboard;

  try {
    const storyboardPath = path.join(runsDir, `storyboard_v${version}.json`);
    const storyboardData = await fs.readFile(storyboardPath, 'utf-8');
    storyboard = JSON.parse(storyboardData);
    await addLog(runId, 'INFO', 'ASSETS', `Loaded storyboard with ${storyboard.scenes.length} scenes`);
  } catch (e) {
    await addLog(runId, 'ERROR', 'ASSETS', 'storyboard.json not found');
    throw new Error('Storyboard stage must complete before asset generation');
  }

  // Ensure directories exist
  const assetsDir = path.join(runsDir, 'assets');
  const audioDir = path.join(runsDir, 'audio');
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(audioDir, { recursive: true });

  // Get config
  const config = getConfig();
  const aspectRatio = DEFAULTS.aspectRatio;
  const voiceId = run.config.voiceId || DEFAULTS.voicePreset;
  const voiceMode = run.config.voiceMode || 'preset';
  const bgmPreset = run.config.bgmPreset || 'upbeat_corporate';

  await addLog(runId, 'INFO', 'ASSETS', `Using voice: ${voiceId} (mode: ${voiceMode})`);
  await addLog(runId, 'INFO', 'ASSETS', `Generating ${storyboard.scenes.length} images, TTS, and BGM in parallel...`);

  // ===== PARALLEL EXECUTION =====

  // Task 1: Generate all scene images (with incremental updates, parallel batch processing)
  const IMAGE_CONCURRENCY_LIMIT = 3;

  const generateImages = async (): Promise<string[]> => {
    const imageResults = await processInBatches(
      storyboard.scenes,
      IMAGE_CONCURRENCY_LIMIT,
      async (scene, i) => {
        const sceneNum = i + 1;
        const filename = `scene_${String(sceneNum).padStart(3, '0')}.png`;

        // Apply style template to the visual prompt
        const styleTemplate = getStyleTemplate(
          run.config.imagePromptStyle || 'none',
          run.config.customImagePrompt || ''
        );
        const finalPrompt = styleTemplate ? `${styleTemplate}\n\n${scene.visualPrompt}` : scene.visualPrompt;

        await addLog(runId, 'INFO', 'ASSETS', `Generating image for scene ${sceneNum}: ${scene.visualPrompt.substring(0, 50)}...`);

        const result = await generateImage({
          prompt: finalPrompt,
          aspectRatio,
          sceneNumber: sceneNum,
        });

        // Handle mock mode (returns imageUrl) or real mode (returns imageBase64)
        if (result.success && (result.imageBase64 || result.imageUrl)) {
          const imagePath = path.join(assetsDir, filename);
          if (result.imageBase64) {
            const imageBuffer = Buffer.from(result.imageBase64, 'base64');
            await fs.writeFile(imagePath, imageBuffer);
          } else if (result.imageUrl && result.imageUrl.startsWith('/mocks/')) {
            // In mock mode, copy the mock file
            const mockPath = path.join(process.cwd(), result.imageUrl);
            const mockData = await fs.readFile(mockPath);
            await fs.writeFile(imagePath, mockData);
          }
          await addLog(runId, 'INFO', 'ASSETS', `Saved image: ${filename}`);
          return { sceneNumber: sceneNum, filename, success: true };
        } else {
          const errorMsg = result.error || 'Unknown error';
          await addLog(runId, 'ERROR', 'ASSETS', `Failed to generate image for scene ${sceneNum}: ${errorMsg}`);
          return { sceneNumber: sceneNum, filename: 'placeholder.png', success: false };
        }
      }
    );

    // Collect all results
    const images = imageResults.map(r => r.filename);

    // ===== INCREMENTAL UPDATE: Update status after batch processing completes =====
    const status = await getRunStatus(runId);
    if (status) {
      await updateRunStatus(runId, {
        stageProgress: 40, // 10 + 30
        artifacts: {
          ...status.artifacts,
          images,
        },
      }, baseDir);
    }

    return images;
  };

  // Task 2: Generate TTS for all scenes (parallel, max 2 concurrent for ElevenLabs limit)
  const generateAllTTS = async (): Promise<{ voiceAudioFiles: string[], concatenatedPath: string }> => {
    const voiceAudioFiles: string[] = [];

    // Process TTS in batches of 2 (ElevenLabs limit: max 2 concurrent requests)
    const ELEVENLABS_CONCURRENCY_LIMIT = 2;

    const ttsResults = await processInBatches(
      storyboard.scenes,
      ELEVENLABS_CONCURRENCY_LIMIT,
      async (scene, i) => {
        const sceneNum = i + 1;
        await addLog(runId, 'INFO', 'ASSETS', `Generating TTS for scene ${sceneNum}: ${scene.narrationText.substring(0, 50)}...`);

        const audioBuffer = await generateTTS(scene.narrationText, voiceId);

        // Save voice audio per scene
        const voiceFileName = `voice_${sceneNum}.wav`;
        const voicePath = path.join(audioDir, voiceFileName);
        await fs.writeFile(voicePath, audioBuffer);
        await addLog(runId, 'INFO', 'ASSETS', `Saved voice audio: ${voiceFileName} (${audioBuffer.length} bytes)`);

        return { filename: voiceFileName, buffer: audioBuffer, sceneIndex: i };
      }
    );

    // ===== KEY FIX: Get actual audio durations and update storyboard =====
    await addLog(runId, 'INFO', 'ASSETS', 'Calculating actual TTS audio durations...');

    let totalActualDuration = 0;
    for (const result of ttsResults) {
      const sceneNum = result.sceneIndex + 1;
      const voiceFileName = `voice_${sceneNum}.wav`;
      const voicePath = path.join(audioDir, voiceFileName);

      try {
        const duration = await getAudioDuration(voicePath);
        // Update storyboard scene duration with actual TTS length
        storyboard.scenes[result.sceneIndex].durationSec = Math.round(duration * 10) / 10;
        totalActualDuration += storyboard.scenes[result.sceneIndex].durationSec;
        await addLog(runId, 'INFO', 'ASSETS', `Scene ${sceneNum}: actual duration ${duration.toFixed(2)}s (was ${storyboard.scenes[result.sceneIndex].durationSec}s)`);
      } catch (durationError) {
        const errorMsg = durationError instanceof Error ? durationError.message : 'Unknown error';
        await addLog(runId, 'WARN', 'ASSETS', `Failed to get duration for ${voiceFileName}: ${errorMsg}, keeping original duration`);
        totalActualDuration += storyboard.scenes[result.sceneIndex].durationSec;
      }
    }

    // Update total duration in storyboard
    storyboard.totalDurationSec = Math.round(totalActualDuration * 10) / 10;
    await addLog(runId, 'INFO', 'ASSETS', `Updated storyboard total duration: ${storyboard.totalDurationSec}s`);

    // Save updated storyboard JSON
    const storyboardPath = path.join(runsDir, `storyboard_v${version}.json`);
    await fs.writeFile(storyboardPath, JSON.stringify(storyboard, null, 2));
    await addLog(runId, 'INFO', 'ASSETS', `Saved updated storyboard with actual TTS durations`);

    // Collect filenames and concatenate audio buffers for voice.wav
    let concatenatedBuffer: Buffer | null = null;
    for (const result of ttsResults) {
      voiceAudioFiles.push(result.filename);
      if (!concatenatedBuffer) {
        concatenatedBuffer = result.buffer;
      } else {
        // Concatenate buffers (simple concatenation - in production would need proper audio mixing)
        concatenatedBuffer = Buffer.concat([concatenatedBuffer, result.buffer]);
      }
    }

    // Save concatenated voice.wav
    const concatenatedPath = path.join(audioDir, 'voice.wav');
    if (concatenatedBuffer) {
      await fs.writeFile(concatenatedPath, concatenatedBuffer);
      await addLog(runId, 'INFO', 'ASSETS', `Saved concatenated voice audio: voice.wav (${concatenatedBuffer.length} bytes)`);
    }

    return { voiceAudioFiles, concatenatedPath };
  };

  // Task 3: Generate BGM
  const generateBgm = async (): Promise<string> => {
    const musicLibrary = await getMusicLibrary();
    const selectedMusic = musicLibrary.find(m => m.music_id === bgmPreset) || musicLibrary[0];
    const bgmDuration = Math.ceil(storyboard.totalDurationSec);

    // Guard against undefined selectedMusic
    if (!selectedMusic) {
      throw new Error('No music available in library');
    }

    // Generate content summary from storyboard narration to combine with music style
    await addLog(runId, 'INFO', 'ASSETS', 'Generating content summary from storyboard...');
    const contentSummary = await generateContentSummary(storyboard);
    await addLog(runId, 'INFO', 'ASSETS', `Content summary: "${contentSummary}"`);

    // Combine music style with content for more relevant BGM
    const basePrompt = selectedMusic.prompt || 'upbeat corporate music';
    const combinedPrompt = `${basePrompt}, suitable for ${contentSummary}`;

    await addLog(runId, 'INFO', 'ASSETS', `Generating BGM: ${selectedMusic.title} (${bgmDuration}s)...`);
    await addLog(runId, 'INFO', 'ASSETS', `Combined BGM prompt: ${combinedPrompt}`);

    const bgmPath = path.join(audioDir, 'bgm.wav');

    if (config.USE_MOCK_DATA) {
      const mockBgmPath = path.join(process.cwd(), 'mocks', 'audio', 'bgm.wav');
      const bgmData = await fs.readFile(mockBgmPath);
      await fs.writeFile(bgmPath, bgmData);
      await addLog(runId, 'INFO', 'ASSETS', 'Mock BGM copied');
    } else {
      try {
        const bgmBuffer = await generateBGM(combinedPrompt, bgmDuration);
        await fs.writeFile(bgmPath, bgmBuffer);
        await addLog(runId, 'INFO', 'ASSETS', `Saved BGM: bgm.wav (${bgmBuffer.length} bytes)`);
      } catch (bgmError) {
        const errorMsg = bgmError instanceof Error ? bgmError.message : 'Unknown error';
        await addLog(runId, 'WARN', 'ASSETS', `ElevenLabs BGM failed: ${errorMsg}, trying MiniMax Music-2.5+...`);

        try {
          const bgmBuffer = await generateMusic(combinedPrompt, bgmDuration);
          await fs.writeFile(bgmPath, bgmBuffer);
          await addLog(runId, 'INFO', 'ASSETS', `Saved BGM (MiniMax fallback): bgm.wav (${bgmBuffer.length} bytes)`);
        } catch (minimaxError) {
          const mmErrorMsg = minimaxError instanceof Error ? minimaxError.message : 'Unknown error';
          await addLog(runId, 'ERROR', 'ASSETS', `MiniMax BGM also failed: ${mmErrorMsg}`);
          // Create empty file as fallback
          await fs.writeFile(bgmPath, Buffer.alloc(0));
        }
      }
    }

    return bgmPath;
  };

  // Execute images and TTS in parallel, but track TTS completion separately
  // so we can update voice artifacts as soon as TTS finishes (while BGM continues)
  const imagesPromise = generateImages();
  const ttsPromise = generateAllTTS();
  const bgmPromise = generateBgm();

  // Wait for images and TTS first (they're typically faster)
  const [images, ttsResult] = await Promise.all([imagesPromise, ttsPromise]);

  // ===== KEY FIX: Update voice artifacts as soon as TTS completes =====
  // This allows the storyboard page to play voice while BGM continues generating
  const currentStatus = await getRunStatus(runId);
  if (currentStatus) {
    await updateRunStatus(runId, {
      stageProgress: 70,
      artifacts: {
        ...currentStatus.artifacts,
        images,
        voiceAudio: 'voice.wav',
        voiceAudioFiles: ttsResult.voiceAudioFiles,
      },
    }, baseDir);
    await addLog(runId, 'INFO', 'ASSETS', 'Voice audio available for preview (BGM still generating...)');
  }

  // Continue with BGM in background
  const bgmPath = await bgmPromise;

  // Create mixed audio (placeholder - in production would do actual mixing)
  const mixedPath = path.join(audioDir, 'mixed.wav');
  if (config.USE_MOCK_DATA) {
    const mockMixedPath = path.join(process.cwd(), 'mocks', 'audio', 'mixed.wav');
    const mixedData = await fs.readFile(mockMixedPath);
    await fs.writeFile(mixedPath, mixedData);
  } else {
    // Copy voice as mixed for now
    const voiceFilePath = path.join(audioDir, 'voice.wav');
    try {
      const voiceData = await fs.readFile(voiceFilePath);
      await fs.writeFile(mixedPath, voiceData);
    } catch {
      await fs.writeFile(mixedPath, Buffer.alloc(0));
    }
  }

  // Save manifest
  await saveArtifact(runId, 'assets/manifest.json', JSON.stringify({
    images,
    voiceAudio: 'voice.wav',
    voiceAudioFiles: ttsResult.voiceAudioFiles,
    bgmAudio: 'bgm.wav',
    mixedAudio: 'mixed.wav',
  }, null, 2));

  // Update final status with all artifacts
  const finalStatus = await getRunStatus(runId);
  if (finalStatus) {
    await updateRunStatus(runId, {
      stageProgress: 100,
      artifacts: {
        ...finalStatus.artifacts,
        images,
        voiceAudio: 'voice.wav',
        voiceAudioFiles: ttsResult.voiceAudioFiles,
        bgmAudio: 'bgm.wav',
        mixedAudio: 'mixed.wav',
      },
    }, baseDir);
  }

  await addLog(runId, 'INFO', 'ASSETS', 'Asset generation completed');
}
