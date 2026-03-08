import fs from 'fs/promises';
import path from 'path';
import { Run, addLog, updateRunStatus, saveArtifact } from '../run-manager';
import { chatCompletion } from '../minimax';

const SCRIPT_PROMPT = `You are a professional video script writer. Generate a narration script for a promotional video based on the analysis.

## Output Format

Produce a markdown script with the following structure:

# Script

## Introduction
[Engaging opening hook - about 10-15% of total duration]

## Feature 1: [Name]
[Description and demo narration]

## Feature 2: [Name]
[Description and demo narration]

## [Additional features as needed - typically 2-4 features for a 60s video]

## Conclusion
[Call to action - about 5-10% of total duration]

## Requirements

1. Total script should be suitable for {{DURATION}} seconds (~2.5-3 words per second = {{WORD_COUNT}} words)
2. Make it engaging and professional
3. Include specific details from the analysis
4. Do NOT make claims not supported by the analysis evidence
5. Output ONLY the markdown script, no JSON or other formatting`;

/**
 * SCRIPT stage: Generate narration script
 */
export async function runScriptStage(run: Run): Promise<void> {
  const { id: runId, version, config, baseDir } = run as Run & { baseDir?: string };

  await addLog(runId, 'INFO', 'SCRIPT', 'Starting script generation...', baseDir);
  await updateRunStatus(runId, { stageProgress: 10 }, baseDir);

  const RUNS_DIR = baseDir || path.join(process.cwd(), 'runs');
  const runsDir = path.join(RUNS_DIR, runId);

  // Read analysis from previous stage
  let analysis = {
    oneLiner: '',
    targetUsers: [] as string[],
    features: [] as { name: string; description: string; evidence: string[] }[],
    architecture: '',
    setupSteps: [] as string[],
    evidence: {} as Record<string, string>,
    risks: [] as string[],
    unknowns: [] as string[],
  };

  try {
    const analysisPath = path.join(runsDir, `analysis_v${version}.json`);
    const analysisContent = await fs.readFile(analysisPath, 'utf-8');
    analysis = JSON.parse(analysisContent);
    await addLog(runId, 'INFO', 'SCRIPT', `Loaded analysis: ${analysis.oneLiner}`);
  } catch (e) {
    await addLog(runId, 'ERROR', 'SCRIPT', 'analysis.json not found');
    throw new Error('Analysis stage must complete before script generation');
  }

  await updateRunStatus(runId, { stageProgress: 30 });

  // Calculate expected word count based on duration
  const targetDuration = config.duration || 60;
  const wordsPerSecond = 2.5;
  const targetWordCount = Math.round(targetDuration * wordsPerSecond);

  // Build prompt with analysis data
  const prompt = SCRIPT_PROMPT
    .replace(/\{\{DURATION\}\}/g, String(targetDuration))
    .replace(/\{\{WORD_COUNT\}\}/g, String(targetWordCount));

  const userMessage = `## Repository Analysis

### One-Liner
${analysis.oneLiner}

### Target Users
${analysis.targetUsers.join(', ')}

### Features
${analysis.features.map(f => `- ${f.name}: ${f.description}`).join('\n')}

### Architecture
${analysis.architecture}

### Setup Steps
${analysis.setupSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

### Evidence from Code
${Object.entries(analysis.evidence).map(([k, v]) => `${k}: ${v}`).join('\n')}

Please generate a professional promotional video script based on this analysis.`;

  await addLog(runId, 'INFO', 'SCRIPT', 'Calling MiniMax API for script generation...');

  try {
    const response = await chatCompletion(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: userMessage },
      ],
      {
        temperature: 0.7,
        max_tokens: 4096,
      }
    );

    const script = response.choices[0]?.message?.content || '';

    if (!script) {
      throw new Error('Empty response from MiniMax API');
    }

    await updateRunStatus(runId, { stageProgress: 80 });

    // Save script artifact
    await saveArtifact(runId, `script_v${version}.md`, script);

    await addLog(runId, 'INFO', 'SCRIPT', 'Script generation complete');
    await addLog(runId, 'INFO', 'SCRIPT', `Script length: ${script.length} characters`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await addLog(runId, 'ERROR', 'SCRIPT', `MiniMax API error: ${errorMessage}`);

    // Fallback to placeholder
    const fallbackScript = `# Script

## Introduction
Welcome to this amazing project!

## Features
- Feature 1: Amazing capability
- Feature 2: Incredible performance

## Conclusion
Try it out today!
`;

    await saveArtifact(runId, `script_v${version}.md`, fallbackScript);
    throw error;
  }

  await updateRunStatus(runId, { stageProgress: 100 });
}
