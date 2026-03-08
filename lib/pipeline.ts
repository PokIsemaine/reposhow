import {
  createRun,
  getRun,
  getRunStatus,
  updateRunStatus,
  addLog,
  setRunBaseDir,
  Run,
  RunStatus,
  Stage,
  StageTiming,
} from './run-manager';
import { getConfig } from './config';
import { getProjectRunDir } from './project-manager';

// Stage handlers (to be imported from stages)
import { runFetchStage } from './stages/fetch';
import { runAnalyzeStage } from './stages/analyze';
import { runScriptStage } from './stages/script';
import { runStoryboardStage } from './stages/storyboard';
import { runAssetsStage } from './stages/assets';
import { runRenderStage } from './stages/render';

// Stage order
const STAGE_ORDER: Stage[] = [
  'FETCH',
  'ANALYZE',
  'SCRIPT',
  'STORYBOARD',
  'STORYBOARD_REVIEW',
  'ASSETS',
  'ASSETS_COMPLETE',
  'RENDER',
];

/**
 * Calculate overall progress based on current stage
 */
function calculateOverallProgress(stage: Stage, stageProgress: number): number {
  const stageIndex = STAGE_ORDER.indexOf(stage);
  if (stageIndex === -1) {
    // Final stages
    if (stage === 'COMPLETED') return 100;
    if (stage === 'FAILED' || stage === 'CANCELLED') return 0;
    return 0;
  }

  const stagePercentage = 100 / STAGE_ORDER.length;
  return Math.floor(stageIndex * stagePercentage + (stagePercentage * stageProgress) / 100);
}

/**
 * Run a single stage
 * @param runId - Run ID
 * @param stage - Stage to run
 * @param handler - Stage handler function
 * @param baseDir - Optional base directory for the run
 */
async function runStage(
  runId: string,
  stage: Stage,
  handler: (run: Run) => Promise<void>,
  baseDir?: string
): Promise<void> {
  // Set the current baseDir context for the run
  const previousBaseDir = baseDir;
  setRunBaseDir(baseDir);

  try {
    const run = await getRun(runId, baseDir);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    // Attach baseDir to run object for stage handlers that construct paths directly
    if (baseDir) {
      (run as any).baseDir = baseDir;
    }

    const now = new Date().toISOString();

    // Get current status to preserve existing stage timings
    const currentStatus = await getRunStatus(runId, baseDir);
    const existingTimings: Record<Stage, StageTiming> = currentStatus?.stageTimings || {} as Record<Stage, StageTiming>;

    // Update status to current stage and record start time
    await updateRunStatus(runId, {
      stage,
      stageProgress: 0,
      error: undefined,
      stageTimings: {
        ...existingTimings,
        [stage]: {
          startedAt: now,
        },
      },
    }, baseDir);

    await addLog(runId, 'INFO', stage, `Starting ${stage} stage...`, baseDir);

    // Run the stage handler
    await handler(run);

    const completedAt = new Date().toISOString();

    // Get updated timings and record completion time
    const updatedStatus = await getRunStatus(runId, baseDir);
    const updatedTimings: Record<Stage, StageTiming> = updatedStatus?.stageTimings || {} as Record<Stage, StageTiming>;

    // Mark stage as complete
    await updateRunStatus(runId, {
      stageProgress: 100,
      overallProgress: calculateOverallProgress(stage, 100),
      stageTimings: {
        ...updatedTimings,
        [stage]: {
          ...updatedTimings[stage],
          completedAt,
        },
      },
    }, baseDir);

    await addLog(runId, 'INFO', stage, `${stage} stage completed successfully`, baseDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await addLog(runId, 'ERROR', stage, `Stage failed: ${message}`, baseDir);

    await updateRunStatus(runId, {
      stage: 'FAILED',
      error: message,
      overallProgress: calculateOverallProgress(stage, 0),
    }, baseDir);

    throw error;
  } finally {
    // Restore previous baseDir
    setRunBaseDir(previousBaseDir);
  }
}

/**
 * Execute the full pipeline for a run
 * @param runId - Run ID
 * @param projectId - Optional project ID for project-based runs
 */
export async function executePipeline(runId: string, projectId?: string): Promise<void> {
  const config = getConfig(); // Validate config at start
  const baseDir = projectId ? getProjectRunDir(projectId, '') : undefined;
  const status = await getRunStatus(runId, baseDir);

  if (!status) {
    throw new Error(`Run status not found: ${runId}`);
  }

  // Determine starting stage
  let startIndex = 0;
  if (status.stage !== 'QUEUED' && status.stage !== 'FAILED') {
    // Resume from current stage
    const currentIndex = STAGE_ORDER.indexOf(status.stage);
    if (currentIndex !== -1) {
      startIndex = currentIndex;
    }
  }

  const startedAt = new Date().toISOString();

  // Record pipeline start time
  await updateRunStatus(runId, {
    startedAt,
  }, baseDir);

  await addLog(runId, 'INFO', undefined, `Pipeline starting from stage ${STAGE_ORDER[startIndex]}`, baseDir);

  // Run each stage in order
  for (let i = startIndex; i < STAGE_ORDER.length; i++) {
    const stage = STAGE_ORDER[i];

    // Check if cancelled before each stage
    const currentStatus = await getRunStatus(runId, baseDir);
    if (currentStatus?.stage === 'CANCELLED') {
      await addLog(runId, 'WARN', undefined, 'Pipeline cancelled by user', baseDir);
      return;
    }

    try {
      switch (stage) {
        case 'FETCH':
          await runStage(runId, stage, runFetchStage, baseDir);
          break;
        case 'ANALYZE':
          await runStage(runId, stage, runAnalyzeStage, baseDir);
          break;
        case 'SCRIPT':
          await runStage(runId, stage, runScriptStage, baseDir);
          break;
        case 'STORYBOARD':
          await runStage(runId, stage, runStoryboardStage, baseDir);
          // After STORYBOARD, pause and wait for user review
          await updateRunStatus(runId, {
            stage: 'STORYBOARD_REVIEW',
            stageProgress: 100,
            overallProgress: calculateOverallProgress('STORYBOARD', 100),
          }, baseDir);
          await addLog(runId, 'INFO', 'STORYBOARD_REVIEW', 'Storyboard ready for review', baseDir);
          return; // Stop here, wait for user approval
        case 'STORYBOARD_REVIEW':
          // This stage is handled by approveStoryboard function
          break;
        case 'ASSETS':
          await runStage(runId, stage, runAssetsStage, baseDir);
          // Pause here, wait for user to trigger rendering
          await updateRunStatus(runId, {
            stage: 'ASSETS_COMPLETE',
            stageProgress: 100,
            overallProgress: calculateOverallProgress('ASSETS', 100),
          }, baseDir);
          await addLog(runId, 'INFO', 'ASSETS_COMPLETE', 'Assets generation complete. Ready to render.', baseDir);
          return; // Stop here, wait for user to trigger render
        case 'ASSETS_COMPLETE':
          // This stage is handled by startRender function
          break;
        case 'RENDER':
          await runStage(runId, stage, runRenderStage, baseDir);
          break;
      }
    } catch (error) {
      // Stage failed, pipeline stops
      await addLog(runId, 'ERROR', undefined, `Pipeline failed at stage ${stage}`, baseDir);
      return;
    }
  }

  // All stages complete
  const completedAt = new Date().toISOString();
  await updateRunStatus(runId, {
    stage: 'COMPLETED',
    stageProgress: 100,
    overallProgress: 100,
    completedAt,
  }, baseDir);

  await addLog(runId, 'INFO', undefined, 'Pipeline completed successfully', baseDir);
}

/**
 * Start a new run and execute pipeline
 * @param config - Run configuration
 * @param projectId - Optional project ID for project-based runs
 */
export async function startRun(
  config: {
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
    customImagePrompt: string;
  },
  projectId?: string
): Promise<Run> {
  // Validate config
  getConfig();

  // Determine base directory for the run
  const baseDir = projectId ? getProjectRunDir(projectId, '') : undefined;

  // Create the run
  const run = await createRun(config, baseDir || undefined);

  await addLog(run.id, 'INFO', undefined, `Run created with ID: ${run.id}`, baseDir || undefined);

  // Execute pipeline asynchronously
  // In production, this would be a job queue; for MVP, run immediately
  executePipeline(run.id, projectId).catch(error => {
    console.error(`Pipeline failed for run ${run.id}:`, error);
  });

  return run;
}

/**
 * Retry from failed stage
 * @param runId - Run ID
 * @param projectId - Optional project ID for project-based runs
 */
export async function retryRun(runId: string, projectId?: string): Promise<void> {
  const baseDir = projectId ? getProjectRunDir(projectId, '') : undefined;
  const status = await getRunStatus(runId, baseDir);

  if (!status) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (status.stage !== 'FAILED') {
    throw new Error('Can only retry failed runs');
  }

  // Reset to the failed stage
  await updateRunStatus(runId, {
    stage: status.stage, // Will retry the same stage
    stageProgress: 0,
    error: undefined,
  }, baseDir);

  await addLog(runId, 'INFO', undefined, `Retrying run from ${status.stage} stage`, baseDir);

  // Re-execute pipeline
  executePipeline(runId, projectId).catch(error => {
    console.error(`Pipeline failed for run ${runId}:`, error);
  });
}

/**
 * Cancel a running pipeline
 * @param runId - Run ID
 * @param projectId - Optional project ID for project-based runs
 */
export async function cancelRun(runId: string, projectId?: string): Promise<void> {
  const baseDir = projectId ? getProjectRunDir(projectId, '') : undefined;
  const status = await getRunStatus(runId, baseDir);

  if (!status) {
    throw new Error(`Run not found: ${runId}`);
  }

  // Can only cancel if running or queued
  const canCancel = STAGE_ORDER.includes(status.stage) || status.stage === 'QUEUED';

  if (!canCancel) {
    throw new Error('Cannot cancel a completed or already cancelled run');
  }

  await updateRunStatus(runId, {
    stage: 'CANCELLED',
    error: 'Cancelled by user',
  }, baseDir);

  await addLog(runId, 'INFO', undefined, 'Run cancelled by user', baseDir);
}

/**
 * Approve storyboard and continue pipeline from ASSETS stage
 * @param runId - Run ID
 * @param projectId - Optional project ID for project-based runs
 */
export async function approveStoryboard(runId: string, projectId?: string): Promise<void> {
  const baseDir = projectId ? getProjectRunDir(projectId, '') : undefined;
  const status = await getRunStatus(runId, baseDir);

  if (!status) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (status.stage !== 'STORYBOARD_REVIEW') {
    throw new Error('Storyboard must be in review stage to approve');
  }

  await addLog(runId, 'INFO', 'STORYBOARD_REVIEW', 'Storyboard approved by user, continuing to ASSETS...', baseDir);

  // Update status to ASSETS and continue pipeline
  await updateRunStatus(runId, {
    stage: 'ASSETS',
    stageProgress: 0,
    overallProgress: calculateOverallProgress('ASSETS', 0),
  }, baseDir);

  // Continue pipeline from ASSETS stage
  executePipeline(runId, projectId).catch(error => {
    console.error(`Pipeline failed for run ${runId}:`, error);
  });
}

/**
 * Start rendering from ASSETS_COMPLETE stage
 */
export async function startRender(runId: string, projectId?: string): Promise<void> {
  const baseDir = projectId ? getProjectRunDir(projectId, '') : undefined;
  const status = await getRunStatus(runId, baseDir);

  if (!status) {
    throw new Error(`Run not found: ${runId}`);
  }

  if (status.stage !== 'ASSETS_COMPLETE') {
    throw new Error('Run must be in ASSETS_COMPLETE stage to start rendering');
  }

  await addLog(runId, 'INFO', 'ASSETS_COMPLETE', 'Starting video rendering...', baseDir);

  // Continue pipeline from RENDER stage
  executePipeline(runId, projectId).catch(error => {
    console.error(`Pipeline failed for run ${runId}:`, error);
  });
}

/**
 * Get next stage (for skipping completed ones on retry)
 */
export function getNextStage(currentStage: Stage): Stage | null {
  const index = STAGE_ORDER.indexOf(currentStage);
  if (index === -1 || index === STAGE_ORDER.length - 1) {
    return null;
  }
  return STAGE_ORDER[index + 1];
}
