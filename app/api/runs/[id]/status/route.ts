import { NextRequest, NextResponse } from 'next/server';
import { getRunStatus, getRun, getLogs, findRun } from '@/lib/run-manager';

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

    const [status, run, logs] = await Promise.all([
      getRunStatus(id, baseDir),
      getRun(id, baseDir),
      getLogs(id, 50, baseDir),
    ]);

    if (!status || !run) {
      return NextResponse.json(
        { error: 'Run not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      runId: id,
      stage: status.stage,
      stageProgress: status.stageProgress,
      overallProgress: status.overallProgress,
      error: status.error,
      artifacts: status.artifacts,
      version: run.version,
      config: run.config,
      logs,
      stageTimings: status.stageTimings,
      startedAt: status.startedAt,
      completedAt: status.completedAt,
      updatedAt: status.updatedAt,
      // Analysis progress fields
      analysisStep: status.analysisStep,
      analysisStepMessage: status.analysisStepMessage,
      analysisProgress: status.analysisProgress,
      analysisHistory: status.analysisHistory,
    });
  } catch (error) {
    console.error('Error getting status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
