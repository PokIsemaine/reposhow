import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { findRun, getRunStatus, getLogs } from '@/lib/run-manager';
import { getEvents, appendEvent, getLatestEventId } from '@/lib/event-store';

/**
 * GET /api/runs/[id]/analyze/stream
 * Stream analysis progress using Server-Sent Events (SSE)
 *
 * Query params:
 * - lastEventId: Only return events after this ID (for resumability)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;
  const { searchParams } = new URL(request.url);
  const lastEventIdParam = searchParams.get('lastEventId');
  const lastEventId = lastEventIdParam ? parseInt(lastEventIdParam, 10) : 0;

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let controllerClosed = false;

      const sendEvent = (data: any, eventId?: number) => {
        if (controllerClosed) return;

        try {
          // Include event ID for client to track
          const eventData = { ...data, eventId };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(eventData)}\n\n`));
        } catch (e) {
          // Mark as closed and ignore errors when controller is closed
          if (e instanceof TypeError && e.message.includes('Invalid state')) {
            controllerClosed = true;
          }
          // Don't log these errors as they're expected when client disconnects
        }
      };

      const sendThinking = (content: string, eventId?: number) => {
        sendEvent({ type: 'thinking', content }, eventId);
      };

      try {
        // Find the run
        const runResult = await findRun(runId);
        if (!runResult) {
          sendEvent({ type: 'error', message: 'Run not found' });
          controller.close();
          return;
        }

        const { baseDir } = runResult;
        const runDir = path.join(baseDir, runId);

        // Send initial event to confirm connection (with latest event ID)
        const latestEventId = await getLatestEventId(runId, baseDir);
        sendEvent({ type: 'connected', message: 'Stream connected', lastEventId: latestEventId });

        // If lastEventId is provided, send historical events first
        if (lastEventId > 0) {
          const historicalEvents = await getEvents(runId, lastEventId, baseDir);
          for (const event of historicalEvents) {
            sendEvent({ type: event.type, ...event.data }, event.id);
          }
        }

        let lastLogCount = 0;
        let lastThinkingPosition = 0;
        let analysisComplete = false;
        let lastSentEventId = lastEventId;

        // Poll for updates
        while (!analysisComplete && !controllerClosed) {
          // Check if controller was closed before starting this iteration
          if (controllerClosed) break;

          const status = await getRunStatus(runId, baseDir);

          if (!status) {
            sendEvent({ type: 'error', message: 'Status not found' });
            break;
          }

          // Check if analysis is complete or failed
          if (status.stage !== 'ANALYZE' && status.stage !== 'ANALYZE_CLARIFY') {
            if (status.stage === 'SCRIPT' || status.stage === 'STORYBOARD' || status.stage === 'STORYBOARD_REVIEW') {
              analysisComplete = true;
              const event = await appendEvent(runId, {
                type: 'complete',
                timestamp: Date.now(),
                data: { step: 'complete', message: 'Analysis complete!', progress: 100 },
              }, baseDir);
              sendEvent({ type: 'complete', step: 'complete', message: 'Analysis complete!', progress: 100 }, event.id);
            } else if (status.stage === 'FAILED') {
              const event = await appendEvent(runId, {
                type: 'error',
                timestamp: Date.now(),
                data: { message: status.error || 'Analysis failed' },
              }, baseDir);
              sendEvent({ type: 'error', message: status.error || 'Analysis failed' }, event.id);
            }
            break;
          }

          // If in ANALYZE_CLARIFY stage, continue sending updates
          if (status.stage === 'ANALYZE_CLARIFY') {
            // Check for new events in the store
            const newEvents = await getEvents(runId, lastSentEventId, baseDir);
            for (const event of newEvents) {
              sendEvent({ type: event.type, ...event.data }, event.id);
              lastSentEventId = event.id;
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }

          // Read thinking.jsonl file and send new content
          const thinkingFilePath = path.join(runDir, 'thinking.jsonl');
          try {
            const thinkingContent = await fs.readFile(thinkingFilePath, 'utf-8');
            const thinkingLines = thinkingContent.split('\n').filter(line => line.trim());

            // Send only new thinking content
            if (thinkingLines.length > lastThinkingPosition) {
              for (let i = lastThinkingPosition; i < thinkingLines.length; i++) {
                try {
                  const chunk = JSON.parse(thinkingLines[i]);
                  const event = await appendEvent(runId, {
                    type: 'thinking',
                    timestamp: chunk.timestamp || Date.now(),
                    data: { content: chunk.content || '' },
                  }, baseDir);
                  sendThinking(chunk.content || '', event.id);
                  lastSentEventId = event.id;
                } catch (e) {
                  // Skip malformed JSON
                }
              }
              lastThinkingPosition = thinkingLines.length;
            }
          } catch (e) {
            // thinking.jsonl might not exist yet, ignore
          }

          // Get logs to determine current step
          const logs = await getLogs(runId, 100, baseDir);
          const analyzeLogs = logs.filter(log => log.stage === 'ANALYZE');

          // Determine current step from logs
          let currentStep = 'init';
          let currentMessage = 'Initializing...';
          let progress = status.stageProgress || 0;
          let currentScore: number | undefined;
          let questionsCount: number | undefined;
          let currentIteration: number | undefined;

          const currentStage = status.stage as string;

          // Check clarification state
          if (currentStage === 'ANALYZE_CLARIFY') {
            try {
              const clarPath = path.join(runDir, 'clarity_evaluation.json');
              const clarContent = await fs.readFile(clarPath, 'utf-8');
              const clar = JSON.parse(clarContent);
              if (clar.clarification_needed?.questions?.length > 0) {
                questionsCount = clar.clarification_needed.questions.length;
              }
              if (clar.clarityScore?.total) {
                currentScore = clar.clarityScore.total;
              }
              if (clar.iteration) {
                currentIteration = clar.iteration;
              }
            } catch (e) {
              // Ignore
            }
            currentStep = 'clarification';
            currentMessage = 'Awaiting user clarification...';
            progress = 60;
          } else if (currentStage === 'ANALYZE') {
            // Read clarity evaluation file for scoring info
            try {
              const clarityPath = path.join(runDir, 'clarity_evaluation.json');
              const clarityContent = await fs.readFile(clarityPath, 'utf-8');
              const clarity = JSON.parse(clarityContent);
              if (clarity.clarityScore?.total) {
                currentScore = clarity.clarityScore.total;
              }
              if (clarity.iteration) {
                currentIteration = clarity.iteration;
              }
              if (clarity.clarification_needed?.questions?.length > 0) {
                questionsCount = clarity.clarification_needed.questions.length;
              }
            } catch (e) {
              // Clarity file might not exist yet
            }

            // Analyze logs to find current step
            let latestLogMatch: 'starting' | 'loading' | 'corpus' | 'scoring' | 'analyzing' | 'clarification' | null = null;

            // Find latest step based on logs
            for (let i = analyzeLogs.length - 1; i >= 0; i--) {
              const log = analyzeLogs[i];
              const msg = log.message.toLowerCase();

              // Check in order of priority (most specific first)
              if (msg.includes('calling minimax') || msg.includes('ai analysis')) {
                latestLogMatch = 'analyzing';
                break;
              } else if (msg.includes('clarification') && (msg.includes('need') || msg.includes('needed') || msg.includes('awaiting'))) {
                latestLogMatch = 'clarification';
                const qMatch = log.message.match(/round\s*(\d+)/i);
                if (qMatch) {
                  currentIteration = parseInt(qMatch[1], 10);
                }
                const qCountMatch = log.message.match(/(\d+)\s*questions?/i);
                if (qCountMatch) {
                  questionsCount = parseInt(qCountMatch[1], 10);
                }
                break;
              } else if (msg.includes('clarity score') || msg.includes('evaluating clarity') || msg.includes('evaluating repository clarity')) {
                latestLogMatch = 'scoring';
                const iterMatch = log.message.match(/round\s*(\d+)/i);
                if (iterMatch) {
                  currentIteration = parseInt(iterMatch[1], 10);
                }
                const scoreMatch = log.message.match(/(\d+)\/100/);
                if (scoreMatch) {
                  currentScore = parseInt(scoreMatch[1], 10);
                }
                break;
              } else if (msg.includes('loaded') && msg.includes('corpus')) {
                latestLogMatch = 'corpus';
              } else if (msg.includes('loaded') && msg.includes('repotree')) {
                latestLogMatch = 'loading';
              } else if (msg.includes('starting') && latestLogMatch === null) {
                latestLogMatch = 'starting';
              }
            }

            // Set current step based on latest match
            if (latestLogMatch) {
              currentStep = latestLogMatch;
              switch (latestLogMatch) {
                case 'starting':
                  currentMessage = 'Starting analysis...';
                  progress = 5;
                  currentScore = undefined;
                  break;
                case 'loading':
                  currentMessage = 'Loading repository structure...';
                  progress = 20;
                  currentScore = undefined;
                  break;
                case 'corpus':
                  currentMessage = 'Processing key files...';
                  progress = 30;
                  currentScore = undefined;
                  break;
                case 'scoring':
                  currentMessage = currentScore !== undefined
                    ? `Evaluating clarity (Round ${currentIteration || 1}): ${currentScore}/100`
                    : `Evaluating clarity (Round ${currentIteration || 1})...`;
                  progress = 30 + ((currentIteration || 1) * 5);
                  break;
                case 'analyzing':
                  currentMessage = 'Analyzing code with AI...';
                  progress = 60;
                  currentScore = undefined;
                  questionsCount = undefined;
                  break;
                case 'clarification':
                  currentMessage = `Clarification needed (Round ${currentIteration || 1})...`;
                  progress = 40 + ((currentIteration || 1) * 5);
                  break;
              }
            }
          }

          // Send progress update if there are new logs or progress changed
          if (analyzeLogs.length > lastLogCount || progress > 0) {
            const event = await appendEvent(runId, {
              type: 'progress',
              timestamp: Date.now(),
              data: { step: currentStep, message: currentMessage, progress, score: currentScore, questionsCount, iteration: currentIteration },
            }, baseDir);
            sendEvent({ type: 'progress', step: currentStep, message: currentMessage, progress, score: currentScore, questionsCount, iteration: currentIteration }, event.id);
            lastSentEventId = event.id;
            lastLogCount = analyzeLogs.length;
          }

          // Check for completion
          if (progress >= 100 || status.stage !== 'ANALYZE') {
            analysisComplete = true;
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error('Stream error:', error);
        sendEvent({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      controller.close();
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
