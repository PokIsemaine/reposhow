import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Directory for all runs
const RUNS_DIR = path.join(process.cwd(), 'runs');
const PROJECTS_DIR = path.join(process.cwd(), 'projects');

// Context for current run execution (used to track project directory)
let currentBaseDir: string | undefined;

/**
 * Set the current base directory for run operations
 */
export function setRunBaseDir(baseDir: string | undefined): void {
  currentBaseDir = baseDir;
}

/**
 * Get the current base directory for run operations
 */
export function getRunBaseDir(): string | undefined {
  return currentBaseDir;
}

/**
 * Get the path to a run's directory (supports both top-level and project runs)
 */
export function getRunDir(runId: string, baseDir?: string): string {
  return path.join(baseDir || currentBaseDir || RUNS_DIR, runId);
}

/**
 * Find a run by ID, searching both top-level runs and project runs
 * @returns Run with baseDir if found, null otherwise
 */
export async function findRun(runId: string): Promise<{ run: Run; baseDir: string } | null> {
  // First check top-level runs directory
  const topLevelRun = await getRun(runId, RUNS_DIR);
  if (topLevelRun) {
    return { run: topLevelRun, baseDir: RUNS_DIR };
  }

  // Then search in projects
  try {
    const projectDirs = await fs.readdir(PROJECTS_DIR, { withFileTypes: true });

    for (const dir of projectDirs) {
      if (dir.isDirectory()) {
        const projectRunsDir = path.join(PROJECTS_DIR, dir.name, 'runs');
        try {
          const projectRun = await getRun(runId, projectRunsDir);
          if (projectRun) {
            return { run: projectRun, baseDir: projectRunsDir };
          }
        } catch {
          // Project runs directory doesn't exist, skip
        }
      }
    }
  } catch {
    // Projects directory doesn't exist
  }

  return null;
}

// Pipeline stages
export type Stage =
  | 'QUEUED'
  | 'FETCH'
  | 'ANALYZE'
  | 'ANALYZE_CLARIFY'
  | 'SCRIPT'
  | 'STORYBOARD'
  | 'STORYBOARD_REVIEW'
  | 'ASSETS'
  | 'ASSETS_COMPLETE'
  | 'RENDER'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

// Run configuration (user input)
export interface RunConfig {
  repoUrl?: string;
  localPath?: string;
  token?: string;
  instructions?: string;
  duration: number;
  resolution: 'youtube' | 'x' | 'tiktok';
  voiceMode: 'preset' | 'clone';
  voiceId?: string;
  voiceSample?: string;
  bgmPreset: string;
  bgmVolume: number;
  imagePromptStyle: 'none' | 'flat-illustration' | 'tech-dashboard' | '3d-render' | 'minimal' | 'custom';
  customImagePrompt?: string;
}

// Run metadata (stored in run.json)
export interface Run {
  id: string;
  version: number;
  createdAt: string;
  config: RunConfig;
  // Runtime property (not persisted) - used to track project directory
  baseDir?: string;
}

// Stage timing information
export interface StageTiming {
  startedAt?: string;
  completedAt?: string;
}

// Clarification question
export interface ClarificationQuestion {
  id: string;
  category: 'functionality' | 'tech_stack' | 'target_users' | 'other';
  question: string;
  options?: string[];
}

// Status (stored in status.json)
export interface RunStatus {
  stage: Stage;
  stageProgress: number; // 0-100 for current stage
  overallProgress: number; // 0-100
  error?: string;
  artifacts: {
    repoTree?: string;
    corpus?: string;
    analysis?: string;
    script?: string;
    storyboard?: string;
    images?: string[];
    voiceAudio?: string;
    voiceAudioFiles?: string[];
    bgmAudio?: string;
    mixedAudio?: string;
    outputMp4?: string;
    subtitles?: string;
  };
  // Analysis clarification
  clarification_questions?: ClarificationQuestion[];
  user_answers?: Record<string, string>;
  // Timing fields
  stageTimings: Record<Stage, StageTiming>;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  // Analysis progress (for historical display)
  analysisStep?: string;
  analysisStepMessage?: string;
  analysisProgress?: number;
  // Complete analysis step history
  analysisHistory?: AnalysisProgressEvent[];
}

// Analysis progress event for history
export interface AnalysisProgressEvent {
  step: string;
  message: string;
  progress: number;
  timestamp: number;
  duration?: number;
  score?: number;
  questionsCount?: number;
  iteration?: number;
}

// Log entry
export interface LogEntry {
  time: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  stage?: Stage;
  message: string;
}

/**
 * Ensure runs directory exists
 */
async function ensureRunsDir(baseDir?: string): Promise<void> {
  try {
    await fs.mkdir(baseDir || currentBaseDir || RUNS_DIR, { recursive: true });
  } catch (error) {
    // Directory already exists
  }
}

/**
 * Get path to a specific file in a run's directory
 */
export function getRunFilePath(runId: string, filename: string, baseDir?: string): string {
  return path.join(getRunDir(runId, baseDir || currentBaseDir), filename);
}

/**
 * Create a new run with config
 * @param config - Run configuration
 * @param baseDir - Optional base directory for the run (for project-based runs)
 */
export async function createRun(config: RunConfig, baseDir?: string): Promise<Run> {
  await ensureRunsDir(baseDir);

  const runId = uuidv4();
  const runDir = getRunDir(runId, baseDir);

  // Create run directory
  await fs.mkdir(runDir, { recursive: true });

  // Only create repo subdirectory if NOT using shared localPath
  // When localPath is set, the run uses the shared repo from the project
  if (!config.localPath) {
    await fs.mkdir(path.join(runDir, 'repo'), { recursive: true });
  }

  await fs.mkdir(path.join(runDir, 'assets'), { recursive: true });
  await fs.mkdir(path.join(runDir, 'audio'), { recursive: true });

  // Create run.json
  const run: Run = {
    id: runId,
    version: 1,
    createdAt: new Date().toISOString(),
    config,
  };

  await fs.writeFile(
    getRunFilePath(runId, 'run.json', baseDir),
    JSON.stringify(run, null, 2)
  );

  // Create initial status.json
  const status: RunStatus = {
    stage: 'QUEUED',
    stageProgress: 0,
    overallProgress: 0,
    artifacts: {},
    stageTimings: {} as Record<Stage, StageTiming>,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    getRunFilePath(runId, 'status.json', baseDir),
    JSON.stringify(status, null, 2)
  );

  // Create empty logs file
  await fs.writeFile(getRunFilePath(runId, 'logs.jsonl', baseDir), '');

  return run;
}

/**
 * Get run by ID
 * @param runId - Run ID
 * @param baseDir - Optional base directory for the run
 */
export async function getRun(runId: string, baseDir?: string): Promise<Run | null> {
  try {
    const content = await fs.readFile(getRunFilePath(runId, 'run.json', baseDir), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get run status
 * @param runId - Run ID
 * @param baseDir - Optional base directory for the run
 */
export async function getRunStatus(runId: string, baseDir?: string): Promise<RunStatus | null> {
  try {
    const content = await fs.readFile(getRunFilePath(runId, 'status.json', baseDir), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Update run status
 * @param runId - Run ID
 * @param status - Status to update
 * @param baseDir - Optional base directory for the run
 */
export async function updateRunStatus(
  runId: string,
  status: Partial<RunStatus>,
  baseDir?: string
): Promise<void> {
  const current = await getRunStatus(runId, baseDir);
  if (!current) {
    throw new Error(`Run not found: ${runId}`);
  }

  const updated: RunStatus = {
    ...current,
    ...status,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    getRunFilePath(runId, 'status.json', baseDir),
    JSON.stringify(updated, null, 2)
  );
}

/**
 * Add a log entry to the run's logs
 */
export async function addLog(
  runId: string,
  level: LogEntry['level'],
  stage: LogEntry['stage'],
  message: string,
  baseDir?: string
): Promise<void> {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    level,
    stage,
    message,
  };

  const logPath = getRunFilePath(runId, 'logs.jsonl', baseDir);
  await fs.appendFile(logPath, JSON.stringify(entry) + '\n');
}

/**
 * Get recent log entries for a run
 */
export async function getLogs(runId: string, limit = 100, baseDir?: string): Promise<LogEntry[]> {
  try {
    const content = await fs.readFile(getRunFilePath(runId, 'logs.jsonl', baseDir), 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * Get all runs (summary list)
 * @param baseDir - Optional base directory to list runs from
 */
export async function listRuns(baseDir?: string): Promise<Run[]> {
  const dir = baseDir || RUNS_DIR;
  await ensureRunsDir(dir);

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const runs: Run[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const run = await getRun(entry.name, baseDir);
      if (run) {
        runs.push(run);
      }
    }
  }

  // Sort by createdAt descending
  return runs.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Save artifact to file
 */
export async function saveArtifact(
  runId: string,
  artifactName: string,
  content: string | Buffer,
  baseDir?: string
): Promise<string> {
  const filePath = getRunFilePath(runId, artifactName, baseDir);

  if (Buffer.isBuffer(content)) {
    await fs.writeFile(filePath, content);
  } else {
    await fs.writeFile(filePath, content);
  }

  return filePath;
}

/**
 * Read artifact content
 */
export async function readArtifact(
  runId: string,
  artifactName: string,
  baseDir?: string
): Promise<Buffer | null> {
  try {
    return await fs.readFile(getRunFilePath(runId, artifactName, baseDir));
  } catch {
    return null;
  }
}

/**
 * Increment version (for feedback loop)
 */
export async function incrementVersion(runId: string, baseDir?: string): Promise<number> {
  const run = await getRun(runId, baseDir);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  run.version += 1;
  await fs.writeFile(
    getRunFilePath(runId, 'run.json', baseDir),
    JSON.stringify(run, null, 2)
  );

  return run.version;
}

/**
 * Delete a run
 */
export async function deleteRun(runId: string, baseDir?: string): Promise<void> {
  const runDir = getRunDir(runId, baseDir);
  await fs.rm(runDir, { recursive: true, force: true });
}
