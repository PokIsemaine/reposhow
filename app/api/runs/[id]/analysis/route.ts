import { NextRequest, NextResponse } from 'next/server';
import { findRun, getRunStatus, addLog, updateRunStatus } from '@/lib/run-manager';

/**
 * GET /api/runs/[id]/analysis
 * Get analysis details for a run
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;

  try {
    // Find the run
    const runResult = await findRun(runId);
    if (!runResult) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const { run, baseDir } = runResult;

    // Get run status
    const status = await getRunStatus(runId, baseDir);
    if (!status) {
      return NextResponse.json({ error: 'Status not found' }, { status: 404 });
    }

    // Check if analysis exists
    const analysisArtifact = status.artifacts.analysis;

    // Check if we're in analyzing stage - try to read pre-analysis clarity
    let preAnalysisClarity: any = null;
    if ((status.stage === 'ANALYZE' || status.stage === 'ANALYZE_CLARIFY') && !analysisArtifact) {
      try {
        const fs = await import('fs/promises');
        const path = await import('path');
        const preAnalysisPath = path.join(baseDir, runId, 'clarity_evaluation.json');
        const preAnalysisContent = await fs.readFile(preAnalysisPath, 'utf-8');
        preAnalysisClarity = JSON.parse(preAnalysisContent);
      } catch (e) {
        // Pre-analysis clarity not available yet
      }
    }

    if (!analysisArtifact) {
      return NextResponse.json({
        runId,
        status: status.stage === 'ANALYZE_CLARIFY' ? 'needs_clarification' : (status.stage === 'ANALYZE' ? 'analyzing' : 'pending'),
        version: run.version,
        analysis: null,
        clarityScore: preAnalysisClarity?.clarityScore || null,
        clarificationQuestions: preAnalysisClarity?.clarification_needed?.questions || [],
      });
    }

    // Read the analysis file
    const fs = await import('fs/promises');
    const path = await import('path');
    const analysisPath = path.join(baseDir, runId, analysisArtifact);

    let analysis: any = null;
    try {
      const content = await fs.readFile(analysisPath, 'utf-8');
      analysis = JSON.parse(content);
    } catch (e) {
      // Analysis file might not exist yet
    }

    // Check if clarification is needed
    let needsClarification = false;
    let clarityScore = null;
    if (analysis) {
      needsClarification =
        ((analysis as any).clarityScore && (analysis as any).clarityScore.total < 70) ||
        (analysis.unknowns && analysis.unknowns.length > 0) ||
        (analysis.clarification_needed && analysis.clarification_needed.questions && analysis.clarification_needed.questions.length > 0);
      clarityScore = (analysis as any).clarityScore;
    }

    // Read clarification history if exists
    const clarificationHistory: any[] = [];
    try {
      const historyPath = path.join(baseDir, runId, 'clarification_history.jsonl');
      const historyContent = await fs.readFile(historyPath, 'utf-8');
      const lines = historyContent.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          clarificationHistory.push(JSON.parse(line));
        } catch (e) {
          // Skip invalid lines
        }
      }
    } catch (e) {
      // No history yet
    }

    // Read thinking.jsonl content if exists
    let thinkingContent = '';
    try {
      const thinkingPath = path.join(baseDir, runId, 'thinking.jsonl');
      const thinkingFileContent = await fs.readFile(thinkingPath, 'utf-8');
      const thinkingLines = thinkingFileContent.split('\n').filter(line => line.trim());
      // Parse thinking entries and join content
      for (const line of thinkingLines) {
        try {
          const chunk = JSON.parse(line);
          thinkingContent += chunk.content || '';
        } catch (e) {
          // Skip malformed lines
        }
      }
    } catch (e) {
      // thinking.jsonl might not exist yet
    }

    return NextResponse.json({
      runId,
      status: analysis ? 'complete' : (status.stage === 'ANALYZE_CLARIFY' ? 'needs_clarification' : (status.stage === 'ANALYZE' ? 'analyzing' : 'pending')),
      version: run.version,
      analysis,
      needsClarification,
      clarityScore,
      clarificationQuestions: analysis?.clarification_needed?.questions || [],
      clarificationHistory,
      thinkingContent,
    });
  } catch (error) {
    console.error('Error fetching analysis:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analysis' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/runs/[id]/analysis
 * Submit user answers to clarification questions and trigger re-analysis
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;

  try {
    const body = await request.json();
    const { answers } = body;

    if (!answers || typeof answers !== 'object') {
      return NextResponse.json(
        { error: 'Invalid answers format' },
        { status: 400 }
      );
    }

    // Find the run
    const runResult = await findRun(runId);
    if (!runResult) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const { baseDir } = runResult;

    // Save user answers to a file
    const fs = await import('fs/promises');
    const path = await import('path');
    const answersPath = path.join(baseDir, runId, 'clarification_answers.json');
    await fs.writeFile(answersPath, JSON.stringify(answers, null, 2));

    // Get current status to check if we're in ANALYZE_CLARIFY stage
    const status = await getRunStatus(runId, baseDir);

    // If in ANALYZE_CLARIFY stage, resume analysis by setting stage back to ANALYZE
    if (status?.stage === 'ANALYZE_CLARIFY') {
      await updateRunStatus(runId, { stage: 'ANALYZE', stageProgress: 50 }, baseDir);
      await addLog(runId, 'INFO', 'ANALYZE', 'Resuming analysis after user clarification', baseDir);
    }

    // Get current clarity score for history
    let currentClarityScore = null;
    let currentQuestions = [];
    try {
      if (status?.artifacts?.analysis) {
        const analysisPath = path.join(baseDir, runId, status.artifacts.analysis);
        const analysisContent = await fs.readFile(analysisPath, 'utf-8');
        const analysis = JSON.parse(analysisContent);
        currentClarityScore = analysis.clarityScore;
        currentQuestions = analysis.clarification_needed?.questions || [];
      }
    } catch (e) {
      // Ignore errors reading analysis
    }

    // Append to clarification history with clarity score and questions
    const historyPath = path.join(baseDir, runId, 'clarification_history.jsonl');
    const historyEntry = JSON.stringify({
      timestamp: Date.now(),
      answers,
      clarityScore: currentClarityScore,
      questions: currentQuestions,
    });
    await fs.appendFile(historyPath, historyEntry + '\n');

    await addLog(runId, 'INFO', 'ANALYZE', 'User provided clarification answers', baseDir);

    return NextResponse.json({
      success: true,
      message: 'Answers saved. Re-analysis will continue with provided context.',
    });
  } catch (error) {
    console.error('Error saving answers:', error);
    return NextResponse.json(
      { error: 'Failed to save answers' },
      { status: 500 }
    );
  }
}
