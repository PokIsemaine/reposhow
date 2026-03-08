import fs from 'fs/promises';
import path from 'path';
import { Run, addLog, updateRunStatus, saveArtifact, getRunStatus, getRunDir } from '../run-manager';
import { chatCompletionJSON, streamCompletion } from '../minimax';
import { appendEvent } from '../event-store';

interface AnalysisFeature {
  name: string;
  description: string;
  evidence: string[];
}

interface Analysis {
  oneLiner: string;
  targetUsers: string[];
  features: AnalysisFeature[];
  architecture: string;
  setupSteps: string[];
  evidence: Record<string, string>;
  risks: string[];
  unknowns: string[];
  clarityScore?: ClarityScore;
  clarification_needed?: {
    questions: ClarificationQuestion[];
  };
}

interface ClarificationQuestion {
  id: string;
  category: 'functionality' | 'tech_stack' | 'target_users' | 'other';
  question: string;
  options?: string[];
  allowMultiple?: boolean;
  allowCustom?: boolean;
}

interface ClarityScore {
  total: number;
  breakdown: {
    readme: number;
    codeStructure: number;
    dependencies: number;
    features: number;
  };
  issues: string[];
}

const ANALYSIS_PROMPT = `You are an expert code analyst. Analyze the given GitHub repository and produce a structured analysis.

## Input

You will receive repository file tree and key file contents. You may also receive user clarification answers if available.

## Output Schema

Your analysis MUST be a JSON object with this exact structure:

{
  "oneLiner": "One sentence describing what this project does",
  "targetUsers": ["Developer type 1", "Developer type 2"],
  "features": [
    {
      "name": "Feature name",
      "description": "What it does",
      "evidence": ["Evidence from code/README"]
    }
  ],
  "architecture": "Brief architecture description (e.g., React SPA, Node.js REST API, Monorepo)",
  "setupSteps": ["Step 1", "Step 2"],
  "evidence": {
    "keyFile": "specific evidence from that file"
  },
  "risks": ["Potential issue 1"],
  "unknowns": ["Things unclear from analysis"],
  "clarification_needed": {
    "questions": [
      {
        "id": "q1",
        "category": "functionality|tech_stack|target_users|other",
        "question": "What does this project do?",
        "options": ["Option A", "Option B"]
      }
    ]
  }
}

## Requirements

1. Each feature MUST have at least one evidence from the provided corpus
2. Be objective - don't overhype
3. If something is unclear, note it in unknowns
4. Focus on what's notable/interesting about this repo
5. Keep evidence concise - 1-2 sentences max per item
6. Limit features to 3-5 most important ones
7. Output ONLY valid JSON, no markdown formatting
8. If the repo information is vague or insufficient (e.g., empty corpus, generic names), add clarification_needed with specific questions to ask the user
9. Use user clarification answers if provided to improve accuracy`;

// Concise prompt for retry - reduces output complexity
const ANALYSIS_PROMPT_CONCISE = `You are an expert code analyst. Analyze the given repository.

Output ONLY valid JSON with this exact structure (keep it brief):

{
  "oneLiner": "One sentence project description",
  "targetUsers": ["User 1", "User 2"],
  "features": [{"name": "Feature", "description": "Brief description", "evidence": ["One line evidence"]}],
  "architecture": "Brief description",
  "setupSteps": ["Step 1", "Step 2"],
  "evidence": {"file": "Brief evidence"},
  "risks": ["Risk if any"],
  "unknowns": ["Unknown if any"],
  "clarification_needed": {"questions": []}
}

Focus on 3-5 key features only. Output valid JSON. If info is vague, add clarification_needed questions.`;

const CLARITY_EVALUATION_PROMPT = `You are an expert code analyst. Evaluate the clarity of a repository based on the provided analysis.

## Input

You will receive:
- repoTree: File tree of the repository
- corpus: Key file contents
- analysis: Current analysis results (if available)

## Output Schema

Your evaluation MUST be a JSON object with this exact structure:

{
  "clarityScore": {
    "total": 0-100,
    "breakdown": {
      "readme": 0-25,
      "codeStructure": 0-25,
      "dependencies": 0-25,
      "features": 0-25
    },
    "issues": ["Issue 1", "Issue 2"]
  },
  "clarification_needed": {
    "questions": [
      {
        "id": "q1",
        "category": "functionality|tech_stack|target_users|other",
        "question": "What does this project do?",
        "options": ["Option A", "Option B"],
        "allowMultiple": false,
        "allowCustom": true
      }
    ]
  }
}

## Scoring Criteria

### README (0-25)
- 25: Comprehensive README with clear description instructions, setup, examples
- 15-20: Basic README present but missing some details
- 5-10: Minimal README or very generic
- 0: No README or completely useless

### Code Structure (0-25)
- 25: Clear folder structure, well-organized files, clear naming
- 15-20: Reasonable structure but some confusion
- 5-10: Messy or unclear structure
- 0: No clear structure

### Dependencies (0-25)
- 25: Clear package.json or dependency files with versions
- 15-20: Some dependency info but incomplete
- 5-10: Vague or missing dependency info
- 0: No dependency information

### Features (0-25)
- 25: Clear feature list with good descriptions and evidence
- 15-20: Some features identified but vague
- 5-10: Few features, mostly unclear
- 0: No clear features identified

## Requirements

1. If total score >= 70, set clarification_needed.questions to empty array
2. If total score < 70, generate 1-3 specific questions to clarify
3. Each question should have 2-4 options when possible
4. Questions should address the lowest-scoring areas
5. Output ONLY valid JSON, no markdown formatting`;

/**
 * Evaluate repository clarity before/during analysis
 */
export async function evaluateClarity(
  repoTree: { tree: any[], fileCount: number },
  corpus: Record<string, string>,
  existingAnalysis?: Analysis | null
): Promise<{ clarityScore: ClarityScore; clarification_needed?: { questions: ClarificationQuestion[] } }> {
  const messages = [
    { role: 'system' as const, content: CLARITY_EVALUATION_PROMPT },
    {
      role: 'user' as const,
      content: `## Repository File Tree
${JSON.stringify(repoTree.tree.slice(0, 100), null, 2)}

## Key File Contents
${Object.entries(corpus).map(([file, content]) => `### ${file}\n${content.slice(0, 2000)}`).join('\n\n')}

${existingAnalysis ? `## Current Analysis\n${JSON.stringify(existingAnalysis, null, 2)}` : ''}`
    },
  ];

  try {
    const response = await chatCompletionJSON<any>(messages, { temperature: 0.3, max_tokens: 2048 });
    const result = response;

    return {
      clarityScore: result.clarityScore || { total: 50, breakdown: { readme: 10, codeStructure: 10, dependencies: 15, features: 15 }, issues: ['Unable to evaluate'] },
      clarification_needed: result.clarification_needed,
    };
  } catch (error) {
    console.error('Clarity evaluation failed:', error);
    // Return a default low score on error
    return {
      clarityScore: {
        total: 50,
        breakdown: { readme: 10, codeStructure: 10, dependencies: 15, features: 15 },
        issues: ['Evaluation failed - using default score'],
      },
    };
  }
}

/**
 * Check if clarification is needed based on clarity score
 */
export function needsClarification(analysis: Analysis): boolean {
  const score = analysis.clarityScore?.total ?? 100;
  const hasQuestions = (analysis.clarification_needed?.questions?.length ?? 0) > 0;
  return score < 70 || hasQuestions;
}

/**
 * Load user clarification answers from file
 */
async function loadClarificationAnswers(runsDir: string): Promise<Record<string, string> | null> {
  try {
    const clarAnswersPath = path.join(runsDir, 'clarification_answers.json');
    const clarContent = await fs.readFile(clarAnswersPath, 'utf-8');
    const answers = JSON.parse(clarContent);
    // Clear the answers file after loading
    await fs.unlink(clarAnswersPath);
    return answers;
  } catch (e) {
    return null;
  }
}

/**
 * Wait for user clarification answers with timeout
 */
async function waitForClarificationAnswers(runId: string, runsDir: string, baseDir?: string): Promise<Record<string, string> | null> {
  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 2000; // 2 seconds
  const startWaitTime = Date.now();

  while (Date.now() - startWaitTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    const answers = await loadClarificationAnswers(runsDir);
    if (answers && Object.keys(answers).length > 0) {
      await addLog(runId, 'INFO', 'ANALYZE', `Received ${Object.keys(answers).length} user clarification answers, continuing...`);
      return answers;
    }

    // Check if run was cancelled
    const currentStatus = await getRunStatus(runId, baseDir);
    if (currentStatus?.stage === 'CANCELLED') {
      await addLog(runId, 'INFO', 'ANALYZE', 'Run cancelled during clarification wait');
      return null;
    }
  }

  await addLog(runId, 'WARN', 'ANALYZE', 'Timed out waiting for clarification');
  return null;
}

/**
 * ANALYZE stage: Use MiniMax to analyze repository
 * Implements a scoring loop: Score → If < 70, ask clarification → User answers → Score again → ...
 * After loop exits (score >= 70), run AI analysis
 */
export async function runAnalyzeStage(run: Run): Promise<void> {
  const { id: runId, config, baseDir } = run as Run & { baseDir?: string };

  await addLog(runId, 'INFO', 'ANALYZE', 'Starting code analysis...', baseDir);
  await updateRunStatus(runId, { stageProgress: 5 }, baseDir);

  // Get run directory
  const runsDir = getRunDir(runId, baseDir);

  // Send initial event
  await appendEvent(runId, {
    type: 'progress',
    timestamp: Date.now(),
    data: { step: 'starting', message: 'Starting analysis...', progress: 5 },
  }, baseDir);

  // Read repository data
  let repoTree = { tree: [] as any[], fileCount: 0 };
  let corpus: Record<string, string> = {};

  try {
    const repoTreePath = path.join(runsDir, 'repoTree.json');
    const repoTreeContent = await fs.readFile(repoTreePath, 'utf-8');
    repoTree = JSON.parse(repoTreeContent);
    await addLog(runId, 'INFO', 'ANALYZE', `Loaded repoTree with ${repoTree.fileCount} files`);

    await appendEvent(runId, {
      type: 'progress',
      timestamp: Date.now(),
      data: { step: 'loading', message: 'Loading repository structure...', progress: 15 },
    }, baseDir);
  } catch (e) {
    await addLog(runId, 'WARN', 'ANALYZE', 'repoTree.json not found, using empty tree');
  }

  try {
    const corpusPath = path.join(runsDir, 'corpus.json');
    const corpusContent = await fs.readFile(corpusPath, 'utf-8');
    corpus = JSON.parse(corpusContent);
    await addLog(runId, 'INFO', 'ANALYZE', `Loaded corpus with ${Object.keys(corpus).length} entries`);

    await appendEvent(runId, {
      type: 'progress',
      timestamp: Date.now(),
      data: { step: 'corpus', message: 'Processing key files...', progress: 25 },
    }, baseDir);
  } catch (e) {
    await addLog(runId, 'WARN', 'ANALYZE', 'corpus.json not found, using empty corpus');
    corpus = {
      'README.md': '# Sample Project\n\nA demo repository for testing the RepoShow pipeline.',
      'package.json': '{"name": "sample", "version": "1.0.0", "description": "A sample project"}',
    };
  }

  await updateRunStatus(runId, { stageProgress: 30 }, baseDir);

  // ===== SCORING LOOP =====
  // Loop: Evaluate clarity → If >= 70, break → Else ask clarification → Repeat
  let iteration = 0;
  let userAnswers: Record<string, string> | null = null;
  let latestClarityScore = 0;
  let latestQuestions: ClarificationQuestion[] = [];
  const MAX_ITERATIONS = 5;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    await addLog(runId, 'INFO', 'ANALYZE', `Evaluating clarity (Round ${iteration})...`);

    await appendEvent(runId, {
      type: 'progress',
      timestamp: Date.now(),
      data: {
        step: 'loading',
        message: `Evaluating clarity (Round ${iteration})...`,
        progress: 30 + (iteration * 5),
        score: latestClarityScore || undefined,
        iteration,
      },
    }, baseDir);

    // Evaluate clarity with any previous user answers
    const clarityResult = await evaluateClarity(repoTree, corpus, null);
    latestClarityScore = clarityResult.clarityScore.total;
    latestQuestions = clarityResult.clarification_needed?.questions || [];

    // Save clarity to file for real-time display
    const clarityPath = path.join(runsDir, 'clarity_evaluation.json');
    await fs.writeFile(clarityPath, JSON.stringify({
      clarityScore: clarityResult.clarityScore,
      clarification_needed: { questions: latestQuestions },
      iteration,
      evaluatedAt: Date.now(),
    }, null, 2));

    await addLog(runId, 'INFO', 'ANALYZE', `Clarity score (Round ${iteration}): ${latestClarityScore}/100`);

    await appendEvent(runId, {
      type: 'progress',
      timestamp: Date.now(),
      data: {
        step: 'scoring',
        message: `Evaluating clarity (Round ${iteration}): ${latestClarityScore}/100`,
        progress: 35 + (iteration * 5),
        score: latestClarityScore,
        iteration,
      },
    }, baseDir);

    // Check if score is sufficient
    if (latestClarityScore >= 70) {
      await addLog(runId, 'INFO', 'ANALYZE', `Clarity score ${latestClarityScore}/100 is sufficient, proceeding to AI analysis...`);
      break; // Exit loop, proceed to AI analysis
    }

    // Score < 70: Need clarification
    if (latestQuestions.length === 0) {
      // No specific questions but score is low - add default question
      latestQuestions = [{
        id: 'q1',
        category: 'functionality',
        question: 'What does this project do?',
        allowCustom: true,
      }];
    }

    await addLog(runId, 'WARN', 'ANALYZE', `Low clarity score (${latestClarityScore}/100), need clarification: ${latestQuestions.length} questions`);

    await appendEvent(runId, {
      type: 'progress',
      timestamp: Date.now(),
      data: {
        step: 'clarification',
        message: `Clarification needed (Round ${iteration})...`,
        progress: 40 + (iteration * 5),
        score: latestClarityScore,
        questionsCount: latestQuestions.length,
        iteration,
      },
    }, baseDir);

    // Set stage to pause and wait for user answers
    await updateRunStatus(runId, { stage: 'ANALYZE_CLARIFY', stageProgress: 50 }, baseDir);

    // Wait for user answers
    userAnswers = await waitForClarificationAnswers(runId, runsDir, baseDir);

    if (userAnswers === null) {
      // Cancelled or timed out
      await addLog(runId, 'WARN', 'ANALYZE', 'No clarification received, proceeding anyway...');
    }

    // Restore stage to ANALYZE and continue loop
    await updateRunStatus(runId, { stage: 'ANALYZE', stageProgress: 30 + (iteration * 5) }, baseDir);

    // Check if run was cancelled
    const currentStatus = await getRunStatus(runId, baseDir);
    if (currentStatus?.stage === 'CANCELLED') {
      await addLog(runId, 'INFO', 'ANALYZE', 'Run cancelled');
      return;
    }
  }

  // ===== AFTER LOOP: AI ANALYSIS =====
  // Only reaches here when score >= 70 or max iterations reached
  await addLog(runId, 'INFO', 'ANALYZE', 'Proceeding to AI analysis...');

  await appendEvent(runId, {
    type: 'progress',
    timestamp: Date.now(),
    data: { step: 'analyzing', message: 'Analyzing code with AI...', progress: 60 },
  }, baseDir);

  // Build prompt with repository data and any user answers
  let userClarification = '';
  if (userAnswers && Object.keys(userAnswers).length > 0) {
    userClarification = `\n## User Clarification Answers\n${JSON.stringify(userAnswers, null, 2)}\n`;
  }

  const userMessage = `## Repository File Tree
${JSON.stringify(repoTree.tree.slice(0, 100), null, 2)}

## Key File Contents
${Object.entries(corpus).map(([file, content]) => `### ${file}\n${content.slice(0, 3000)}`).join('\n\n')}${userClarification}`;

  await addLog(runId, 'INFO', 'ANALYZE', 'Calling MiniMax API for analysis...');

  // Create thinking.jsonl file for streaming output
  const thinkingFilePath = path.join(runsDir, 'thinking.jsonl');
  let thinkingFileHandle: fs.FileHandle | null = null;

  let analysis: Analysis | null = null;
  let lastError: string | null = null;

  // Try with full prompt first, then concise prompt on failure
  const prompts = [
    { prompt: ANALYSIS_PROMPT, maxTokens: 4096 },
    { prompt: ANALYSIS_PROMPT_CONCISE, maxTokens: 8192 },
  ];

  for (let attempt = 0; attempt < prompts.length; attempt++) {
    const { prompt, maxTokens } = prompts[attempt];

    try {
      await addLog(runId, 'INFO', 'ANALYZE', `Attempt ${attempt + 1}: Calling MiniMax API...`);

      // Use streaming to capture thinking process
      thinkingFileHandle = await fs.open(thinkingFilePath, 'w');

      let fullContent = '';
      const messages = [
        { role: 'system' as const, content: prompt },
        { role: 'user' as const, content: userMessage },
      ];

      for await (const chunk of streamCompletion(messages, {
        temperature: 0.7,
        max_tokens: maxTokens,
      })) {
        fullContent += chunk;

        // Write thinking chunk to file
        await thinkingFileHandle.write(JSON.stringify({
          timestamp: Date.now(),
          content: chunk,
        }) + '\n');
      }

      await thinkingFileHandle.close();
      thinkingFileHandle = null;

      // Parse the accumulated content as JSON
      let jsonStr = fullContent.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7);
      }
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3);
      }
      jsonStr = jsonStr.trim();

      analysis = JSON.parse(jsonStr) as Analysis;

      await addLog(runId, 'INFO', 'ANALYZE', `Attempt ${attempt + 1} succeeded`);
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await addLog(runId, 'WARN', 'ANALYZE', `Attempt ${attempt + 1} failed: ${lastError}`);

      // Close thinking file on error
      if (thinkingFileHandle) {
        await thinkingFileHandle.close();
        thinkingFileHandle = null;
      }

      // If this is a JSON parse error and we have retries left, continue
      if (attempt < prompts.length - 1 && lastError.includes('parse')) {
        continue;
      }
    }
  }

  if (!analysis) {
    await addLog(runId, 'ERROR', 'ANALYZE', `MiniMax API failed after all retries: ${lastError}`);

    // Fallback to placeholder on error
    const fallbackAnalysis: Analysis = {
      oneLiner: 'Analysis failed - using placeholder',
      targetUsers: ['Developers'],
      features: [],
      architecture: 'Unknown',
      setupSteps: ['Run npm install', 'Run npm start'],
      evidence: {},
      risks: ['Analysis API failed'],
      unknowns: ['Could not analyze repository'],
    };

    await saveArtifact(runId, `analysis_v${run.version}.json`, JSON.stringify(fallbackAnalysis, null, 2));
    throw new Error(`MiniMax API failed: ${lastError}`);
  }

  await updateRunStatus(runId, { stageProgress: 85 }, baseDir);

  // Add final clarity score to analysis
  analysis.clarityScore = {
    total: latestClarityScore,
    breakdown: { readme: 0, codeStructure: 0, dependencies: 0, features: 0 },
    issues: [],
  };

  // Save analysis artifact
  await saveArtifact(runId, `analysis_v${run.version}.json`, JSON.stringify(analysis, null, 2));

  await addLog(runId, 'INFO', 'ANALYZE', `Analysis complete: ${analysis.oneLiner}`);
  await addLog(runId, 'INFO', 'ANALYZE', `Found ${analysis.features.length} features`);

  await updateRunStatus(runId, { stageProgress: 100 }, baseDir);
}
