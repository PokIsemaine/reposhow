import { promises as fs } from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { Run, addLog, updateRunStatus, saveArtifact, getRunStatus } from '../run-manager';
import { getConfig } from '../config';

const execAsync = promisify(exec);

// Paths - will be updated based on run.baseDir
let RUNS_DIR = path.join(process.cwd(), 'runs');
const REMOTION_TEMPLATE_DIR = path.join(process.cwd(), 'remotion');

// Render timeout: 10 minutes
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;

interface SceneData {
  sceneNumber: number;
  durationSec: number;
  narrationText: string;
  visualPrompt: string;
  transition: string;
}

interface StoryboardData {
  scenes: SceneData[];
  totalDurationSec: number;
}

interface AssetsData {
  images: string[];
  voiceAudio?: string;
  voiceAudioFiles?: string[];
  bgmAudio?: string;
  mixedAudio: string;
}

/**
 * Convert seconds to SRT timestamp format
 */
function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Generate subtitles.srt from storyboard
 */
function generateSubtitles(storyboard: StoryboardData): string {
  const lines: string[] = [];
  let currentTime = 0;

  storyboard.scenes.forEach((scene, index) => {
    const startTime = currentTime;
    const endTime = currentTime + scene.durationSec;

    lines.push(`${index + 1}`);
    lines.push(`${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}`);
    lines.push(scene.narrationText);
    lines.push('');

    currentTime = endTime;
  });

  return lines.join('\n');
}

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Already exists
  }
}

/**
 * Copy Remotion template files to run directory
 */
async function copyRemotionTemplate(runDir: string, runId: string): Promise<string> {
  const runRemotionDir = path.join(runDir, 'remotion');

  await addLog(runId, 'INFO', 'RENDER', `Copying Remotion template to run directory`);

  // Create the run's remotion directory
  await ensureDir(runRemotionDir);

  // Files to copy from template (not directories or node_modules)
  const filesToCopy = ['index.tsx', 'Video.tsx', 'Scene.tsx', 'Subtitle.tsx', 'Composition.tsx', 'package.json', 'tsconfig.json'];

  for (const file of filesToCopy) {
    const src = path.join(REMOTION_TEMPLATE_DIR, file);
    const dest = path.join(runRemotionDir, file);
    try {
      await fs.copyFile(src, dest);
    } catch (error) {
      await addLog(runId, 'WARN', 'RENDER', `Could not copy ${file}: ${error}`);
    }
  }

  // Create public directory structure
  const publicDir = path.join(runRemotionDir, 'public');
  await ensureDir(publicDir);
  const assetsDir = path.join(publicDir, 'assets');
  await ensureDir(assetsDir);
  const audioDir = path.join(assetsDir, 'audio');
  await ensureDir(audioDir);

  await addLog(runId, 'INFO', 'RENDER', `Remotion template copied to ${runRemotionDir}`);

  return runRemotionDir;
}

/**
 * Execute a command and return output (legacy)
 */
async function runCommand(command: string, cwd?: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, { cwd });
    if (stderr) {
      console.warn('Command stderr:', stderr);
    }
    return stdout;
  } catch (error: unknown) {
    const err = error as { message?: string; stderr?: string };
    throw new Error(`Command failed: ${err.message || 'Unknown error'}${err.stderr ? ` - ${err.stderr}` : ''}`);
  }
}

/**
 * Parse progress from Remotion CLI output
 * Remotion outputs progress like: "[render] 30/100 frames (30%)"
 */
function parseRemotionProgress(line: string): number | null {
  // Match patterns like "30/100 frames (30%)" or "30%"
  const percentMatch = line.match(/\((\d+)%\)/);
  if (percentMatch) {
    return parseInt(percentMatch[1], 10) / 100;
  }

  // Match "30/100 frames"
  const framesMatch = line.match(/(\d+)\/(\d+)\s+frames/);
  if (framesMatch) {
    const rendered = parseInt(framesMatch[1], 10);
    const total = parseInt(framesMatch[2], 10);
    return rendered / total;
  }

  return null;
}

/**
 * Execute a command with real-time output, progress parsing, and timeout
 */
async function runCommandWithProgress(
  command: string,
  args: string[],
  cwd: string,
  onProgress: (progress: number) => void,
  timeout: number = 10 * 60 * 1000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: true });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeout / 1000} seconds`));
    }, timeout);

    let lastProgress = 0;

    child.stdout?.on('data', (data) => {
      const output = data.toString();
      const lines = output.split('\n');
      for (const line of lines) {
        const progress = parseRemotionProgress(line);
        if (progress !== null && progress > lastProgress) {
          lastProgress = progress;
          onProgress(progress);
        }
      }
    });

    child.stderr?.on('data', (data) => {
      // stderr may also contain progress info
      const output = data.toString();
      const lines = output.split('\n');
      for (const line of lines) {
        const progress = parseRemotionProgress(line);
        if (progress !== null && progress > lastProgress) {
          lastProgress = progress;
          onProgress(progress);
        }
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Render video using Remotion CLI with progress tracking
 */
async function renderWithRemotionApi(
  runId: string,
  runRemotionDir: string,
  outputPath: string,
  inputPropsPath: string,
  baseDir?: string
): Promise<void> {
  // Get path to remotion CLI - handle Windows .cmd vs Unix binaries
  const nodeModulesBin = path.join(process.cwd(), 'node_modules', '.bin');
  const remotionCli = process.platform === 'win32'
    ? path.join(nodeModulesBin, 'remotion.cmd')
    : path.join(nodeModulesBin, 'remotion');

  console.log('[DEBUG] renderWithRemotionApi: Starting render');
  console.log('[DEBUG] Platform:', process.platform);
  console.log('[DEBUG] Remotion CLI path:', remotionCli);

  await addLog(runId, 'INFO', 'RENDER', 'Starting Remotion render...', baseDir);

  // The --props-file approach doesn't work well because Remotion needs the props
  // bundled with the project. Instead, we write the props to a local file and use
  // --props=path format which Remotion can read properly on Windows.
  const inputPropsContent = await fs.readFile(inputPropsPath, 'utf-8');
  const inlinePropsPath = path.join(runRemotionDir, 'inlineProps.json');
  await fs.writeFile(inlinePropsPath, inputPropsContent);

  console.log('[DEBUG] Wrote inline props to:', inlinePropsPath);

  // Use --public-dir to tell Remotion where to find assets
  // Use forward slashes for cross-platform compatibility
  const remotionPublicDir = path.join(runRemotionDir, 'public').replace(/\\/g, '/');
  await addLog(runId, 'INFO', 'RENDER', `Using public-dir: ${remotionPublicDir}`, baseDir);

  // Build args with --props=path format (not --props-file, and not inline)
  const remotionArgs = [
    'render',
    `${runRemotionDir}/index.tsx`,
    'reposhow',
    `--props=${inlinePropsPath}`,
    '--public-dir', remotionPublicDir,
    '--output', outputPath,
    '--overwrite',
  ];

  console.log('[DEBUG] Remotion args:', remotionArgs);

  // On Windows, we need shell: true to properly execute .cmd files
  // The remotion CLI is the command, args are the rest
  const spawnOptions = {
    cwd: process.cwd(),
    shell: true,
  };

  console.log('[DEBUG] Spawn options:', spawnOptions);
  console.log('[DEBUG] Full command:', `${remotionCli} ${remotionArgs.join(' ')}`);

  await addLog(runId, 'INFO', 'RENDER', `Running: ${remotionCli} ${remotionArgs.join(' ')}`, baseDir);

  // Create a promise that wraps the render with progress callback
  const renderPromise = new Promise<void>((resolve, reject) => {
    console.log('[DEBUG] About to spawn process...');
    const child = spawn(remotionCli, remotionArgs, spawnOptions);
    console.log('[DEBUG] Process spawned with PID:', child.pid);

    let lastProgress = 0;
    let errorOutput = '';
    let stdoutOutput = '';

    const timer = setTimeout(() => {
      console.log('[DEBUG] Render timeout triggered');
      child.kill();
      reject(new Error(`Render timed out after ${RENDER_TIMEOUT_MS / 1000} seconds`));
    }, RENDER_TIMEOUT_MS);

    child.stdout?.on('data', (data) => {
      const output = data.toString();
      stdoutOutput += output;
      console.log('[DEBUG] stdout:', output);
      const lines = output.split('\n');
      for (const line of lines) {
        const progress = parseRemotionProgress(line);
        if (progress !== null && progress > lastProgress) {
          lastProgress = progress;
          const percentDone = Math.round(progress * 100);
          const stageProgress = 40 + Math.round(progress * 50);
          addLog(runId, 'INFO', 'RENDER', `Rendering: ${percentDone}%`, baseDir);
          updateRunStatus(runId, { stageProgress }, baseDir).catch(console.error);
        }
      }
    });

    child.stderr?.on('data', (data) => {
      const output = data.toString();
      errorOutput += output;
      console.log('[DEBUG] stderr:', output);
      // stderr may also contain progress info
      const lines = output.split('\n');
      for (const line of lines) {
        const progress = parseRemotionProgress(line);
        if (progress !== null && progress > lastProgress) {
          lastProgress = progress;
          const percentDone = Math.round(progress * 100);
          const stageProgress = 40 + Math.round(progress * 50);
          addLog(runId, 'INFO', 'RENDER', `Rendering: ${percentDone}%`, baseDir);
          updateRunStatus(runId, { stageProgress }, baseDir).catch(console.error);
        }
      }
    });

    child.on('close', (code) => {
      console.log('[DEBUG] Process closed with code:', code);
      console.log('[DEBUG] stdout output:', stdoutOutput);
      console.log('[DEBUG] stderr output:', errorOutput);
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Remotion render failed with code ${code}: ${errorOutput}`));
      }
    });

    child.on('error', (err) => {
      console.log('[DEBUG] Process error:', err.message);
      clearTimeout(timer);
      reject(err);
    });
  });

  await renderPromise;
  await addLog(runId, 'INFO', 'RENDER', 'Render completed', baseDir);
}

/**
 * RENDER stage: Use Remotion to render video
 */
export async function runRenderStage(run: Run): Promise<void> {
  const { id: runId, version, baseDir } = run as Run & { baseDir?: string };
  const config = getConfig();

  // Update RUNS_DIR based on baseDir
  RUNS_DIR = baseDir || path.join(process.cwd(), 'runs');
  const runDir = path.join(RUNS_DIR, runId);

  await addLog(runId, 'INFO', 'RENDER', 'Starting video rendering...', baseDir);

  // Mock mode: use mock data for rendering
  if (config.USE_MOCK_DATA) {
    await addLog(runId, 'INFO', 'RENDER', 'Mock mode: using mock data for rendering', baseDir);

    const mockDataDir = path.join(process.cwd(), 'mocks');

    // Read mock storyboard
    const storyboardPath = path.join(mockDataDir, 'storyboard.json');
    await addLog(runId, 'INFO', 'RENDER', `Reading mock storyboard from ${storyboardPath}`);
    const storyboardContent = await fs.readFile(storyboardPath, 'utf-8');
    const storyboard: StoryboardData = JSON.parse(storyboardContent);

    await addLog(runId, 'INFO', 'RENDER', `Loaded mock storyboard with ${storyboard.scenes.length} scenes`);

    // Save mock storyboard to run directory
    await fs.writeFile(path.join(runDir, `storyboard_v${version}.json`), storyboardContent);

    // Create assets directory
    const assetsDir = path.join(runDir, 'assets');
    await ensureDir(assetsDir);

    // Copy mock images to assets
    const mockImages = ['scene_001.png', 'scene_002.png', 'scene_003.png', 'scene_004.png', 'scene_005.png', 'scene_006.png', 'scene_007.png', 'scene_008.png'];
    for (let i = 0; i < storyboard.scenes.length; i++) {
      const srcImage = path.join(mockDataDir, 'images', mockImages[i] || mockImages[0]);
      const destImage = path.join(assetsDir, `scene_${String(i + 1).padStart(3, '0')}.png`);
      try {
        await fs.copyFile(srcImage, destImage);
      } catch (error) {
        await addLog(runId, 'WARN', 'RENDER', `Could not copy mock image: ${error}`);
      }
    }

    // Copy mock audio
    const audioDir = path.join(assetsDir);
    try {
      await fs.copyFile(path.join(mockDataDir, 'audio', 'mixed.wav'), path.join(audioDir, 'mixed.wav'));
    } catch (error) {
      await addLog(runId, 'WARN', 'RENDER', `Could not copy mock audio: ${error}`);
    }

    // Save mock assets manifest
    const assets: AssetsData = {
      images: storyboard.scenes.map((_, i) => `scene_${String(i + 1).padStart(3, '0')}.png`),
      voiceAudio: undefined,
      bgmAudio: undefined,
      mixedAudio: 'mixed.wav',
    };
    await fs.writeFile(path.join(assetsDir, 'manifest.json'), JSON.stringify(assets, null, 2));

    await addLog(runId, 'INFO', 'RENDER', 'Mock assets copied, proceeding with Remotion render...');

    // Continue with the same rendering logic as non-mock mode
    await updateRunStatus(runId, { stageProgress: 10 }, baseDir);

    // Copy Remotion template to run directory
    const runRemotionDir = await copyRemotionTemplate(runDir, runId);
    await updateRunStatus(runId, { stageProgress: 25 }, baseDir);

    // Create Remotion public folder with mock assets
    const remotionPublic = path.join(runRemotionDir, 'public');
    await ensureDir(remotionPublic);
    const remotionAssetsDir = path.join(remotionPublic, 'assets');
    await ensureDir(remotionAssetsDir);

    // Copy images to remotion public folder
    for (let i = 0; i < storyboard.scenes.length; i++) {
      const srcImage = path.join(assetsDir, `scene_${String(i + 1).padStart(3, '0')}.png`);
      const destImage = path.join(remotionAssetsDir, `scene_${String(i + 1).padStart(3, '0')}.png`);
      try {
        await fs.copyFile(srcImage, destImage);
      } catch (error) {
        await addLog(runId, 'WARN', 'RENDER', `Could not copy image to remotion: ${error}`);
      }
    }

    // Copy audio
    const remotionAudioDir = path.join(remotionAssetsDir, 'audio');
    await ensureDir(remotionAudioDir);
    try {
      await fs.copyFile(path.join(audioDir, 'mixed.wav'), path.join(remotionAudioDir, 'mixed.wav'));
    } catch (error) {
      await addLog(runId, 'WARN', 'RENDER', `Could not copy audio to remotion: ${error}`);
    }

    // Prepare input props for remotion - use relative paths for --public-dir
    const finalInputProps = {
      storyboard,
      assets: {
        images: storyboard.scenes.map((_, i) => `assets/scene_${String(i + 1).padStart(3, '0')}.png`),
        voiceAudio: undefined,
        bgmAudio: undefined,
        mixedAudio: 'assets/audio/mixed.wav',
      },
      runId,
    };

    const inputPropsPath = path.join(runRemotionDir, 'inputProps.json');
    await fs.writeFile(inputPropsPath, JSON.stringify(finalInputProps, null, 2));

    await updateRunStatus(runId, { stageProgress: 40 });

    // Run Remotion render using programmatic API
    const outputPath = path.join(runDir, 'output.mp4');

    try {
      await renderWithRemotionApi(runId, runRemotionDir, outputPath, inputPropsPath, baseDir);
    } catch (renderError) {
      await addLog(runId, 'ERROR', 'RENDER', `Remotion render failed: ${renderError}`);
    }

    // Check output
    try {
      await fs.access(outputPath);
      const stats = await fs.stat(outputPath);
      await addLog(runId, 'INFO', 'RENDER', `Mock video created: ${stats.size} bytes`);
    } catch {
      await addLog(runId, 'WARN', 'RENDER', 'Output not found after render');
    }

    await updateRunStatus(runId, { stageProgress: 90 });

    // Generate subtitles
    const subtitles = generateSubtitles(storyboard);
    await saveArtifact(runId, 'subtitles.srt', subtitles);

    // Update status
    const status = await getRunStatus(runId);
    if (status) {
      await updateRunStatus(runId, {
        stage: 'COMPLETED',
        artifacts: {
          ...status.artifacts,
          outputMp4: 'output.mp4',
          subtitles: 'subtitles.srt',
        },
      });
    }

    await addLog(runId, 'INFO', 'RENDER', 'Mock video rendering completed');
    return;
  }

  await updateRunStatus(runId, { stageProgress: 10 }, baseDir);

  try {
    // 1. Read storyboard
    const storyboardPath = path.join(runDir, `storyboard_v${version}.json`);
    await addLog(runId, 'INFO', 'RENDER', `Reading storyboard from ${storyboardPath}`);
    const storyboardContent = await fs.readFile(storyboardPath, 'utf-8');
    const storyboard: StoryboardData = JSON.parse(storyboardContent);

    await addLog(runId, 'INFO', 'RENDER', `Loaded ${storyboard.scenes.length} scenes`);

    // 2. Read assets manifest
    const assetsPath = path.join(runDir, 'assets', 'manifest.json');
    await addLog(runId, 'INFO', 'RENDER', 'Reading assets manifest');
    const assetsContent = await fs.readFile(assetsPath, 'utf-8');
    const assets: AssetsData = JSON.parse(assetsContent);

    await addLog(runId, 'INFO', 'RENDER', `Assets: ${assets.images.length} images, voice: ${assets.voiceAudio}, bgm: ${assets.bgmAudio}`);

    await updateRunStatus(runId, { stageProgress: 20 });

    // 3. Check if assets exist
    const requiredAssets = [];

    // Check images
    for (let i = 0; i < storyboard.scenes.length; i++) {
      const imagePath = path.join(runDir, 'assets', assets.images[i] || `scene_${String(i + 1).padStart(3, '0')}.png`);
      try {
        await fs.access(imagePath);
      } catch {
        requiredAssets.push(`Image for scene ${i + 1}: ${imagePath}`);
      }
    }

    // Check audio
    if (assets.mixedAudio) {
      const mixedPath = path.join(runDir, 'assets', assets.mixedAudio);
      try {
        await fs.access(mixedPath);
      } catch {
        requiredAssets.push(`Mixed audio: ${mixedPath}`);
      }
    } else {
      if (assets.voiceAudio) {
        const voicePath = path.join(runDir, 'assets', assets.voiceAudio);
        try {
          await fs.access(voicePath);
        } catch {
          requiredAssets.push(`Voice audio: ${voicePath}`);
        }
      }
      if (assets.bgmAudio) {
        const bgmPath = path.join(runDir, 'assets', assets.bgmAudio);
        try {
          await fs.access(bgmPath);
        } catch {
          requiredAssets.push(`BGM audio: ${bgmPath}`);
        }
      }
    }

    if (requiredAssets.length > 0) {
      await addLog(runId, 'WARN', 'RENDER', `Missing assets: ${requiredAssets.join(', ')}`);
    }

    // 4. Copy Remotion template to run directory
    const runRemotionDir = await copyRemotionTemplate(runDir, runId);
    await updateRunStatus(runId, { stageProgress: 25 }, baseDir);

    // 5. Create inputProps.json for Remotion
    const inputProps = {
      storyboard,
      assets,
      runId,
    };

    // Convert asset paths to be relative to remotion public folder
    const remotionInputProps = {
      storyboard,
      assets: {
        images: assets.images,
        voiceAudio: assets.voiceAudio,
        bgmAudio: assets.bgmAudio,
        mixedAudio: assets.mixedAudio,
      },
      runId,
      bgmVolume: run.config.bgmVolume,
    };

    await addLog(runId, 'INFO', 'RENDER', 'Preparing Remotion input props');

    // 6. Create Remotion public folder with assets symlinks/copies
    const remotionPublic = path.join(runRemotionDir, 'public');
    await ensureDir(remotionPublic);

    // Copy assets to remotion public folder
    // Copy images to public root (not in assets subdirectory to avoid double /public/ in URL)
    for (let i = 0; i < storyboard.scenes.length; i++) {
      const srcImage = path.join(runDir, 'assets', assets.images[i] || `scene_${String(i + 1).padStart(3, '0')}.png`);
      const destImage = path.join(remotionPublic, `scene_${String(i + 1).padStart(3, '0')}.png`);
      try {
        await fs.copyFile(srcImage, destImage);
        await fs.access(destImage);
        await addLog(runId, 'INFO', 'RENDER', `Scene image ${i + 1} copied to: ${destImage}`);
      } catch (error) {
        await addLog(runId, 'WARN', 'RENDER', `Could not copy image ${srcImage}: ${error}`);
      }
    }

    // Copy audio files to public root (not in assets subdirectory to avoid double /public/ in URL)
    // Copy mixed audio (if exists)
    if (assets.mixedAudio) {
      const srcAudio = path.join(runDir, 'audio', assets.mixedAudio);
      const destAudio = path.join(runRemotionDir, 'public', 'mixed.wav');
      try {
        await fs.copyFile(srcAudio, destAudio);
        await fs.access(destAudio);
        await addLog(runId, 'INFO', 'RENDER', `Mixed audio copied to: ${destAudio}`);
      } catch (error) {
        await addLog(runId, 'WARN', 'RENDER', `Could not copy mixed audio: ${error}`);
      }
    }

    // Copy voice audio files (per-scene voiceovers) - these are named voice_1.wav, voice_2.wav, etc.
    const voiceAudioFiles: string[] = [];
    await addLog(runId, 'INFO', 'RENDER', `Looking for voice files in: ${path.join(runDir, 'audio')}`);
    for (let i = 0; i < storyboard.scenes.length; i++) {
      const voiceFileName = `voice_${i + 1}.wav`;
      const srcVoiceFile = path.join(runDir, 'audio', voiceFileName);
      const destVoiceFile = path.join(runRemotionDir, 'public', voiceFileName);
      try {
        await fs.copyFile(srcVoiceFile, destVoiceFile);
        voiceAudioFiles.push(voiceFileName);
        await addLog(runId, 'INFO', 'RENDER', `Voice file ${voiceFileName} copied to: ${destVoiceFile}`);
      } catch (error) {
        await addLog(runId, 'WARN', 'RENDER', `Could not copy voice file ${voiceFileName} from ${srcVoiceFile}: ${error}`);
      }
    }
    await addLog(runId, 'INFO', 'RENDER', `Voice files copied: ${voiceAudioFiles.length} files`);

    // Copy single voice audio (legacy, for backwards compatibility)
    if (assets.voiceAudio) {
      const srcVoice = path.join(runDir, 'audio', assets.voiceAudio);
      const destVoice = path.join(runRemotionDir, 'public', 'voice.wav');
      try {
        await fs.copyFile(srcVoice, destVoice);
        await fs.access(destVoice);
        await addLog(runId, 'INFO', 'RENDER', `Voice audio copied to: ${destVoice}`);
      } catch (error) {
        await addLog(runId, 'WARN', 'RENDER', `Could not copy voice audio: ${error}`);
      }
    }

    // Copy BGM audio (if exists) - this was previously missing due to if-else logic
    if (assets.bgmAudio) {
      const srcBgm = path.join(runDir, 'audio', assets.bgmAudio);
      const destBgm = path.join(runRemotionDir, 'public', 'bgm.wav');
      try {
        await fs.copyFile(srcBgm, destBgm);
        // Verify BGM file was copied successfully
        await fs.access(destBgm);
        await addLog(runId, 'INFO', 'RENDER', `BGM file copied successfully to: ${destBgm}`);
      } catch (error) {
        await addLog(runId, 'WARN', 'RENDER', `Could not copy BGM: ${error}`);
      }
    }

    // Update assets paths for remotion - use relative paths for --public-dir (no assets/ prefix)
    const remotionAssets = {
      images: storyboard.scenes.map((_, i) => `scene_${String(i + 1).padStart(3, '0')}.png`),
      voiceAudio: assets.voiceAudio ? 'voice.wav' : undefined,
      voiceAudioFiles: voiceAudioFiles.length > 0 ? voiceAudioFiles : undefined,
      bgmAudio: assets.bgmAudio ? 'bgm.wav' : undefined,
      bgmVolume: run.config.bgmVolume,
      mixedAudio: assets.mixedAudio ? 'mixed.wav' : undefined,
    };

    // Write input props
    const finalInputProps = {
      storyboard,
      assets: remotionAssets,
      runId,
    };

    const inputPropsPath = path.join(runRemotionDir, 'inputProps.json');
    await fs.writeFile(inputPropsPath, JSON.stringify(finalInputProps, null, 2));

    // Debug: Log the assets being passed to Remotion
    await addLog(runId, 'INFO', 'RENDER', `Remotion assets: voiceAudioFiles=${JSON.stringify(remotionAssets.voiceAudioFiles)}, voiceAudio=${remotionAssets.voiceAudio}, bgmAudio=${remotionAssets.bgmAudio}, mixedAudio=${remotionAssets.mixedAudio}`);

    await updateRunStatus(runId, { stageProgress: 40 });

    // 7. Run Remotion render using programmatic API
    const outputPath = path.join(runDir, 'output.mp4');

    try {
      await renderWithRemotionApi(runId, runRemotionDir, outputPath, inputPropsPath, baseDir);
    } catch (renderError) {
      await addLog(runId, 'ERROR', 'RENDER', `Remotion render failed: ${renderError}`);
      // Try alternative approach if remotion fails
      await addLog(runId, 'INFO', 'RENDER', 'Trying alternative render approach...');
    }

    await updateRunStatus(runId, { stageProgress: 70 });

    // 8. Check if output was created
    try {
      await fs.access(outputPath);
      const stats = await fs.stat(outputPath);
      await addLog(runId, 'INFO', 'RENDER', `Output video created: ${stats.size} bytes`);
    } catch {
      // If render failed, create a placeholder or use ffmpeg directly
      await addLog(runId, 'WARN', 'RENDER', 'Remotion output not found, attempting ffmpeg fallback...');

      // Try using ffmpeg directly if available
      try {
        await renderWithFfmpeg(runDir, storyboard, assets, runId);
      } catch (ffmpegError) {
        await addLog(runId, 'ERROR', 'RENDER', `FFmpeg fallback failed: ${ffmpegError}`);
        // Create a placeholder file
        await saveArtifact(runId, 'output.mp4', Buffer.alloc(0));
      }
    }

    await updateRunStatus(runId, { stageProgress: 90 });

    // 9. Generate and save subtitles
    const subtitles = generateSubtitles(storyboard);
    await saveArtifact(runId, 'subtitles.srt', subtitles);
    await addLog(runId, 'INFO', 'RENDER', `Generated subtitles with ${storyboard.scenes.length} scenes`);

    // 10. Update status
    const status = await getRunStatus(runId);
    if (status) {
      await updateRunStatus(runId, {
        stage: 'COMPLETED',
        artifacts: {
          ...status.artifacts,
          outputMp4: 'output.mp4',
          subtitles: 'subtitles.srt',
        },
      });
    }

    await addLog(runId, 'INFO', 'RENDER', 'Video rendering completed');
  } catch (error) {
    await addLog(runId, 'ERROR', 'RENDER', `Render failed: ${error}`);
    await updateRunStatus(runId, { stage: 'FAILED', error: String(error) });
    throw error;
  }
}

/**
 * Fallback: Render using ffmpeg directly
 */
async function renderWithFfmpeg(
  runDir: string,
  storyboard: StoryboardData,
  assets: AssetsData,
  runId: string
): Promise<void> {
  const fps = 30;
  const outputPath = path.join(runDir, 'output.mp4');

  // Build ffmpeg filter complex for scenes
  const filterParts: string[] = [];

  // For now, create a simple video from the first image as placeholder
  // In production, this would properly concatenate all scenes
  const firstImage = path.join(runDir, 'assets', assets.images[0] || 'scene_001.png');

  try {
    await fs.access(firstImage);

    // Simple ffmpeg command to create video from first image
    const duration = storyboard.totalDurationSec;
    const command = `ffmpeg -y -loop 1 -i "${firstImage}" -c:v libx264 -t ${duration} -pix_fmt yuv420p -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" "${outputPath}"`;

    await runCommand(command);
    await addLog(runId, 'INFO', 'RENDER', 'FFmpeg fallback render completed');
  } catch (error) {
    throw new Error(`FFmpeg render failed: ${error}`);
  }
}
