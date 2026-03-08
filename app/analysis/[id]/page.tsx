'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, Badge, Progress, ThinkingPanel } from '../../components/ui';

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

interface ClarificationQuestion {
  id: string;
  category: string;
  question: string;
  options?: string[];
  allowMultiple?: boolean;
  allowCustom?: boolean;
}

interface ClarificationHistoryEntry {
  timestamp: number;
  answers: Record<string, string | string[]>;
  questions?: ClarificationQuestion[];
  clarityScore?: ClarityScore;
}

interface AnalysisStatus {
  runId: string;
  status: 'pending' | 'analyzing' | 'complete' | 'needs_clarification' | 'error';
  version: number;
  analysis: Analysis | null;
  clarityScore?: ClarityScore;
  clarificationQuestions: ClarificationQuestion[];
  clarificationHistory?: ClarificationHistoryEntry[];
  thinkingContent?: string;
}

interface RunStatus {
  analysisStep?: string;
  analysisStepMessage?: string;
  analysisProgress?: number;
  analysisHistory?: ProgressEvent[];
}

interface ProgressEvent {
  step: string;
  message: string;
  progress: number;
  timestamp: number;
  duration?: number;
  isActive?: boolean;
  score?: number;
  questionsCount?: number;
  iteration?: number;
}

interface StreamEvent {
  type: 'progress' | 'complete' | 'error' | 'thinking';
  step?: string;
  message?: string;
  progress?: number;
  error?: string;
  content?: string;
  isNew?: boolean;
  score?: number;
  questionsCount?: number;
  iteration?: number;
}

const STEP_LABELS: Record<string, string> = {
  starting: 'Starting Analysis',
  loading: 'Loading Repository',
  scoring: 'Evaluating Score',
  analyzing: 'AI Analysis',
  clarification: 'Clarification Needed',
  complete: 'Complete',
};

// Steps that should not be displayed to users (internal steps)
const HIDDEN_STEPS = ['init', 'features'];

// Priority for sorting history events
const STEP_PRIORITY: Record<string, number> = {
  'starting': 0,
  'loading': 1,
  'scoring': 2,
  'analyzing': 3,
  'clarification': 4,
  'complete': 5,
};

export default function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [eventHistory, setEventHistory] = useState<ProgressEvent[]>([]);
  const [thinkingContent, setThinkingContent] = useState('');
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<string, string | string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch analysis status
  const fetchAnalysis = async () => {
    try {
      const [analysisResponse, statusResponse] = await Promise.all([
        fetch(`/api/runs/${id}/analysis`),
        fetch(`/api/runs/${id}/status`),
      ]);

      if (!analysisResponse.ok) {
        throw new Error('Failed to fetch analysis');
      }

      const data = await analysisResponse.json();
      setAnalysisStatus(data);

      // Restore thinking content from API (only if not already populated from SSE)
      if (data.thinkingContent && !thinkingContent) {
        setThinkingContent(data.thinkingContent);
      }

      // Initialize eventHistory from saved history or logs
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();

        // Try to use saved analysisHistory first (most complete)
        if (statusData.analysisHistory && statusData.analysisHistory.length > 0) {
          // Convert saved history to ProgressEvent format
          const historyFromSaved: ProgressEvent[] = statusData.analysisHistory.map((event: any) => ({
            step: event.step,
            message: event.message,
            progress: event.progress,
            timestamp: event.timestamp || Date.now(),
            duration: event.duration,
            score: event.score,
            questionsCount: event.questionsCount,
            iteration: event.iteration,
          }));

          if (data.status === 'complete') {
            // Add complete step if not already there
            const hasComplete = historyFromSaved.some(e => e.step === 'complete');
            if (!hasComplete) {
              historyFromSaved.push({
                step: 'complete',
                message: 'Analysis complete!',
                progress: 100,
                timestamp: Date.now(),
              });
            }
          }

          // Filter out hidden steps (init, features)
          const filteredHistory = historyFromSaved.filter(e => !HIDDEN_STEPS.includes(e.step));

          // Sort by step priority, then by iteration
          const sortedHistory = filteredHistory.sort((a, b) => {
            const priorityA = STEP_PRIORITY[a.step] ?? 99;
            const priorityB = STEP_PRIORITY[b.step] ?? 99;
            if (priorityA !== priorityB) return priorityA - priorityB;
            // For same priority (e.g., scoring rounds), sort by iteration
            return (a.iteration ?? 0) - (b.iteration ?? 0);
          });

          setEventHistory(sortedHistory);
        } else if (statusData.analysisStep && statusData.analysisProgress !== undefined) {
          // Fallback: use single step saved progress
          const savedProgress = {
            step: statusData.analysisStep,
            message: statusData.analysisStepMessage || '',
            progress: statusData.analysisProgress,
          };

          if (data.status === 'complete') {
            // Build history from saved progress
            const historySteps = ['starting', 'loading', 'scoring', 'analyzing'];
            const newHistory: ProgressEvent[] = [];
            let currentProgress = 0;

            for (const step of historySteps) {
              if (step === savedProgress.step) {
                newHistory.push({
                  step,
                  message: savedProgress.message,
                  progress: savedProgress.progress,
                  timestamp: Date.now(),
                });
                break;
              } else {
                const stepProgress = Math.min(currentProgress + 15, 80);
                newHistory.push({
                  step,
                  message: STEP_LABELS[step] || step,
                  progress: stepProgress,
                  timestamp: Date.now(),
                });
                currentProgress = stepProgress;
              }
            }

            newHistory.push({
              step: 'complete',
              message: 'Analysis complete!',
              progress: 100,
              timestamp: Date.now(),
            });

            setEventHistory(newHistory);
          } else {
            setEventHistory([{
              step: savedProgress.step,
              message: savedProgress.message,
              progress: savedProgress.progress,
              timestamp: Date.now(),
            }]);
          }
        } else if (statusData.logs && statusData.logs.length > 0) {
          // Last fallback: rebuild from logs
          const analyzeLogs = statusData.logs.filter((log: any) =>
            log.stage === 'ANALYZE' || log.message?.toLowerCase().includes('analysis')
          );

          if (analyzeLogs.length > 0) {
            const historyFromLogs: ProgressEvent[] = [];
            const stepProgressMap: Record<string, number> = {
              'starting': 10,
              'loading': 25,
              'scoring': 45,
              'analyzing': 70,
              'clarification': 85,
              'complete': 100,
            };

            // Track last known iteration for scoring steps to handle logs without explicit Round number
            let lastScoringIteration: number | undefined;

            // Count iterations from logs
            let preAnalysisCount = 0;
            let postAnalysisCount = 0;

            for (const log of analyzeLogs) {
              const msg = log.message?.toLowerCase() || '';
              let step = 'init';
              let score: number | undefined;
              let questionsCount: number | undefined;
              let iteration: number | undefined;

              // Extract iteration from message if present (e.g., "Round 2")
              const roundMatch = log.message?.match(/Round\s+(\d+)/i);
              if (roundMatch) {
                iteration = parseInt(roundMatch[1], 10);
                lastScoringIteration = iteration;
              }

              if (msg.includes('starting')) step = 'starting';
              else if (msg.includes('loaded') && msg.includes('repotree')) step = 'loading';
              else if (msg.includes('loaded') && msg.includes('corpus')) step = 'loading';
              else if (msg.includes('clarity score') || msg.includes('evaluating')) {
                // Extract score from log message like "Pre-analysis clarity score: 75/100"
                const scoreMatch = log.message?.match(/(\d+)\/100/);
                if (scoreMatch) {
                  score = parseInt(scoreMatch[1], 10);
                }
                // Check for post-analysis to determine if it's a scoring round
                if (msg.includes('post-analysis') || msg.includes('evaluating')) {
                  step = 'scoring';
                  postAnalysisCount++;
                  iteration = postAnalysisCount;
                } else {
                  step = 'scoring';
                  preAnalysisCount++;
                  iteration = preAnalysisCount;
                }
                // Track the last known iteration for scoring steps
                lastScoringIteration = iteration;
              }
              else if (msg.includes('calling minimax')) step = 'analyzing';
              else if (msg.includes('found') && msg.includes('features')) step = 'features';
              else if (msg.includes('need clarification') || msg.includes('clarification')) {
                step = 'clarification';
                // Use current iteration if available, otherwise use last scoring iteration
                if (iteration === undefined) {
                  iteration = lastScoringIteration ?? Math.max(preAnalysisCount, postAnalysisCount, 1);
                }
                // Count questions if available in log
                const qMatch = log.message?.match(/(\d+)\s*questions?/i);
                if (qMatch) {
                  questionsCount = parseInt(qMatch[1], 10);
                }
              }
              else if (msg.includes('complete')) step = 'complete';

              // For scoring steps without explicit iteration, use last known iteration
              if (step === 'scoring' && iteration === undefined && lastScoringIteration !== undefined) {
                iteration = lastScoringIteration;
              }

              // Avoid duplicates (but allow updating score) - match by step and iteration
              const existingIndex = historyFromLogs.findIndex(e =>
                e.step === step &&
                (e.iteration === iteration || (step !== 'scoring' && step !== 'clarification'))
              );
              if (existingIndex >= 0) {
                // Update score if found
                if (score !== undefined) {
                  historyFromLogs[existingIndex].score = score;
                }
                if (questionsCount !== undefined) {
                  historyFromLogs[existingIndex].questionsCount = questionsCount;
                }
                if (iteration !== undefined) {
                  historyFromLogs[existingIndex].iteration = iteration;
                }
              } else {
                historyFromLogs.push({
                  step,
                  message: log.message || STEP_LABELS[step] || step,
                  progress: stepProgressMap[step] || 0,
                  timestamp: new Date(log.time).getTime() || Date.now(),
                  score,
                  questionsCount,
                  iteration,
                });
              }
            }

            if (data.status === 'complete' && !historyFromLogs.some(e => e.step === 'complete')) {
              historyFromLogs.push({
                step: 'complete',
                message: 'Analysis complete!',
                progress: 100,
                timestamp: Date.now(),
              });
            }

            // Filter out hidden steps
            const filteredLogsHistory = historyFromLogs.filter(e => !HIDDEN_STEPS.includes(e.step));
            setEventHistory(filteredLogsHistory);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analysis');
    } finally {
      setLoading(false);
    }
  };

  // Connect to SSE stream for real-time progress
  useEffect(() => {
    const eventSource = new EventSource(`/api/runs/${id}/analyze/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);

        if (data.type === 'thinking') {
          // Accumulate thinking content
          setThinkingContent(prev => prev + (data.content || ''));
        } else if (data.type === 'progress') {
          const step = data.step || 'init';
          const progress = data.progress || 0;
          const message = data.message || '';
          const score = data.score;
          const questionsCount = data.questionsCount;
          const iteration = data.iteration;
          const now = Date.now();

          // Skip hidden steps (init, features)
          if (HIDDEN_STEPS.includes(step)) {
            return;
          }

          setEventHistory(prev => {
            // Check if there's already an event with the same step and iteration
            // For scoring/clarification, we need to match both step and iteration
            const existingIndex = prev.findIndex(e => {
              // For scoring/clarification, must match both step and iteration
              if (step === 'scoring' || step === 'clarification') {
                // Only match if both have the same iteration defined
                // If new event has no iteration, don't match - treat as potential new event
                if (iteration === undefined || e.iteration === undefined) {
                  return false;
                }
                return e.step === step && e.iteration === iteration;
              }
              // Other steps only need to match step
              return e.step === step;
            });

            if (existingIndex >= 0) {
              // Update existing event
              const existing = prev[existingIndex];
              const duration = now - existing.timestamp;

              const updated = [...prev];
              updated[existingIndex] = {
                ...existing,
                message,
                progress,
                duration,
                isActive: progress < 100,
                score: score ?? existing.score,
                questionsCount: questionsCount ?? existing.questionsCount,
                iteration: iteration ?? existing.iteration,
              };

              // Mark all other steps as not active
              return updated.map((e, i) => ({
                ...e,
                isActive: i === existingIndex ? progress < 100 : false,
              }));
            } else {
              // Add new event
              return [...prev, {
                step,
                message,
                progress,
                timestamp: now,
                isActive: progress < 100,
                score,
                questionsCount,
                iteration,
              }];
            }
          });
        } else if (data.type === 'complete') {
          const now = Date.now();
          setEventHistory(prev => {
            // Mark all previous steps as complete (not active)
            const updated = prev.map(e => ({
              ...e,
              isActive: false,
              duration: e.duration || (now - e.timestamp),
            }));
            // Add complete step
            return [...updated, {
              step: 'complete',
              message: 'Analysis complete!',
              progress: 100,
              timestamp: now,
              duration: 0,
              isActive: false,
            }];
          });
          eventSource.close();
          // 直接设置状态为 complete，不需要等待 API 重新获取
          // 这样可以避免文件尚未完全写入导致的闪烁问题
          setAnalysisStatus(prev => prev ? { ...prev, status: 'complete' } : {
            runId: id,
            status: 'complete',
            version: 1,
            analysis: null,
            clarificationQuestions: [],
          });
          // 延迟获取完整数据（不阻塞 UI）
          setTimeout(() => {
            fetchAnalysis();
          }, 1000);
        } else if (data.type === 'error') {
          setError(data.error || 'Analysis failed');
          eventSource.close();
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err);
      }
    };

    eventSource.onerror = () => {
      // Try to fetch current status on connection error
      fetchAnalysis();
    };

    return () => {
      eventSource.close();
    };
  }, [id]);

  // Submit clarification answers
  const submitClarification = async () => {
    if (Object.keys(clarificationAnswers).length === 0) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/runs/${id}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: clarificationAnswers }),
      });

      if (response.ok) {
        // Clear answers and refetch
        setClarificationAnswers({});
        await fetchAnalysis();
      }
    } catch (err) {
      console.error('Failed to submit clarification:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchAnalysis();
  }, [id]);

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        Loading analysis...
      </div>
    );
  }

  if (error && !analysisStatus) {
    return (
      <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-error)' }}>{error}</p>
        <Button onClick={() => router.push('/')} style={{ marginTop: 'var(--space-md)' }}>
          Go Home
        </Button>
      </div>
    );
  }

  const analysis = analysisStatus?.analysis;
  const status = analysisStatus?.status;

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    padding: 'var(--space-xl) var(--space-md)',
  };

  const headerStyle: React.CSSProperties = {
    maxWidth: '900px',
    margin: '0 auto var(--space-xl)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-md)',
  };

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>Analysis Details</h1>
          <Badge variant={status === 'complete' ? 'success' : status === 'analyzing' || status === 'needs_clarification' ? 'default' : 'warning'}>
            {status?.toUpperCase() || 'UNKNOWN'}
          </Badge>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
          <Link href={`/run/${id}`}>
            <Button variant="outline" size="sm">Progress</Button>
          </Link>
          <Link href="/projects">
            <Button variant="outline" size="sm">Projects</Button>
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
        {/* Real-time Progress */}
        {status !== 'complete' && (
          <Card>
            <h3 style={{ marginBottom: 'var(--space-md)' }}>Analysis Progress</h3>
            {eventHistory.length > 0 && (
              <div style={{ marginBottom: 'var(--space-md)' }}>
                <Progress value={eventHistory[eventHistory.length - 1]?.progress || 0} />
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {eventHistory.map((event, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-md)',
                  opacity: event.progress >= 100 ? 0.7 : 1,
                  position: 'relative',
                }}>
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: event.progress >= 100 ? 'var(--color-success)' : 'var(--color-primary)',
                    animation: event.isActive ? 'pulse 1.5s infinite' : 'none',
                    boxShadow: event.isActive ? '0 0 8px var(--color-primary)' : 'none',
                  }} />
                  <span style={{ flex: 1 }}>
                    {STEP_LABELS[event.step] || event.step}
                    {event.iteration !== undefined && event.iteration > 1 && (
                      <span style={{
                        marginLeft: '8px',
                        fontSize: 'var(--text-sm)',
                        color: '#666',
                      }}>
                        [Round {event.iteration}]
                      </span>
                    )}
                    {event.score !== undefined && (
                      <span style={{
                        marginLeft: '8px',
                        fontWeight: 'bold',
                        color: event.score < 70 ? '#f59e0b' : '#10b981',
                      }}>
                        ({event.score}/100)
                      </span>
                    )}
                    {event.questionsCount !== undefined && event.questionsCount > 0 && (
                      <span style={{
                        marginLeft: '8px',
                        fontSize: 'var(--text-sm)',
                        color: '#ef4444',
                      }}>
                        ({event.questionsCount} questions)
                      </span>
                    )}
                  </span>
                  {event.duration !== undefined && (
                    <span style={{ color: '#999', fontSize: 'var(--text-sm)', minWidth: '40px', textAlign: 'right' }}>
                      {(event.duration / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* AI Thinking Process */}
        {status !== 'complete' && status !== 'needs_clarification' && thinkingContent && (
          <ThinkingPanel content={thinkingContent} isStreaming={status === 'analyzing'} />
        )}

        {/* Clarity Score - show during analysis if available */}
        {(status === 'complete' || status === 'analyzing' || status === 'needs_clarification') && (analysisStatus as any).clarityScore && (
          <Card style={{
            background: (analysisStatus as any).clarityScore.total < 70 ? '#fffbf0' : '#f0fff4',
            borderColor: (analysisStatus as any).clarityScore.total < 70 ? '#f59e0b' : '#10b981',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
              <h3 style={{ margin: 0 }}>Clarity Score {status === 'analyzing' ? '(Pre-Analysis)' : ''}</h3>
              <span style={{
                fontSize: 'var(--text-2xl)',
                fontWeight: 'bold',
                color: (analysisStatus as any).clarityScore.total < 70 ? '#f59e0b' : '#10b981',
              }}>
                {(analysisStatus as any).clarityScore.total}/100
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-md)' }}>
              {Object.entries((analysisStatus as any).clarityScore.breakdown).map(([key, value]: [string, any]) => (
                <div key={key} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--text-sm)', color: '#666', textTransform: 'capitalize' }}>
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </div>
                  <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'bold' }}>{value}/25</div>
                </div>
              ))}
            </div>
            {(analysisStatus as any).clarityScore.issues?.length > 0 && (analysisStatus as any).clarityScore.total < 70 && (
              <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
                <strong>Issues:</strong>
                <ul style={{ margin: 'var(--space-xs) 0', paddingLeft: 'var(--space-lg)' }}>
                  {(analysisStatus as any).clarityScore.issues.map((issue: string, i: number) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        {/* Clarification Questions - show during analysis or needs_clarification */}
        {(status === 'complete' || status === 'analyzing' || status === 'needs_clarification') && (analysisStatus as any).clarificationQuestions?.length > 0 && (
          <Card style={{ background: '#fff5f5', borderColor: '#ef4444' }}>
            <h3 style={{ marginBottom: 'var(--space-md)', color: '#ef4444' }}>
              Clarification Needed {status === 'analyzing' ? '(Pre-Analysis)' : ''}
            </h3>
            <p style={{ fontSize: 'var(--text-sm)', color: '#666', marginBottom: 'var(--space-md)' }}>
              The repository has a low clarity score. Please answer these questions to improve the analysis.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
              {(analysisStatus as any).clarificationQuestions.map((q: ClarificationQuestion, i: number) => (
                <div key={q.id}>
                  <p style={{ fontWeight: 'bold', marginBottom: 'var(--space-sm)' }}>{i + 1}. {q.question}</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                    {q.options?.map((option, j) => (
                      <label key={j} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
                        <input
                          type={q.allowMultiple ? 'checkbox' : 'radio'}
                          name={q.id}
                          value={option}
                          checked={
                            q.allowMultiple
                              ? Array.isArray(clarificationAnswers[q.id]) && (clarificationAnswers[q.id] as string[]).includes(option)
                              : clarificationAnswers[q.id] === option
                          }
                          onChange={(e) => {
                            if (q.allowMultiple) {
                              const current = (clarificationAnswers[q.id] as string[]) || [];
                              if (e.target.checked) {
                                setClarificationAnswers({ ...clarificationAnswers, [q.id]: [...current, option] });
                              } else {
                                setClarificationAnswers({ ...clarificationAnswers, [q.id]: current.filter((v: string) => v !== option) });
                              }
                            } else {
                              setClarificationAnswers({ ...clarificationAnswers, [q.id]: option });
                            }
                          }}
                        />
                        {option}
                      </label>
                    ))}
                    {q.allowCustom && (
                      <input
                        type="text"
                        placeholder="Or enter your own answer..."
                        style={{
                          width: '100%',
                          padding: 'var(--space-sm)',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                        }}
                        value={clarificationAnswers[q.id] && !q.options?.includes(clarificationAnswers[q.id] as string) ? clarificationAnswers[q.id] : ''}
                        onChange={(e) => setClarificationAnswers({ ...clarificationAnswers, [q.id]: e.target.value })}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {(status === 'analyzing' || status === 'needs_clarification') && (
              <div style={{ marginTop: 'var(--space-lg)', display: 'flex', gap: 'var(--space-md)' }}>
                <Button
                  onClick={submitClarification}
                  disabled={isSubmitting || Object.keys(clarificationAnswers).length === 0}
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Answers & Re-analyze'}
                </Button>
              </div>
            )}
          </Card>
        )}

        {/* Analysis Results */}
        {status === 'complete' && analysis && (
          <>
            {/* Clarification History */}
            {(analysisStatus as any).clarificationHistory && (analysisStatus as any).clarificationHistory.length > 0 && (
              <Card style={{ background: '#f8fafc' }}>
                <h3 style={{ marginBottom: 'var(--space-md)' }}>Clarification History</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                  {(analysisStatus as any).clarificationHistory.map((entry: ClarificationHistoryEntry, i: number) => (
                    <div key={i} style={{
                      padding: 'var(--space-md)',
                      background: 'white',
                      border: 'var(--border-width) solid var(--color-border)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-sm)' }}>
                        <strong>Round {i + 1}</strong>
                        <span style={{ fontSize: 'var(--text-sm)', color: '#666' }}>
                          {new Date(entry.timestamp).toLocaleString()}
                        </span>
                      </div>
                      {entry.clarityScore && (
                        <div style={{ marginBottom: 'var(--space-sm)', fontSize: 'var(--text-sm)' }}>
                          Clarity Score: <strong>{entry.clarityScore.total}/100</strong>
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                        {Object.entries(entry.answers).map(([qId, answer], j) => {
                          // Try to find the question text from saved questions
                          const savedQuestion = entry.questions?.find((q: ClarificationQuestion) => q.id === qId);
                          const questionText = savedQuestion?.question || qId;
                          return (
                            <div key={j} style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-xs)', background: '#f5f5f5' }}>
                              <div style={{ color: '#666', marginBottom: '2px' }}>Q: {questionText}</div>
                              <div><strong>A:</strong> {Array.isArray(answer) ? answer.join(', ') : answer}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* One-Liner */}
            <Card>
              <h3 style={{ marginBottom: 'var(--space-sm)' }}>One-Line Description</h3>
              <p style={{ fontSize: 'var(--text-lg)', margin: 0 }}>{analysis.oneLiner}</p>
            </Card>

            {/* Target Users */}
            <Card>
              <h3 style={{ marginBottom: 'var(--space-sm)' }}>Target Users</h3>
              <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                {analysis.targetUsers.map((user, i) => (
                  <Badge key={i} variant="default">{user}</Badge>
                ))}
              </div>
            </Card>

            {/* Architecture */}
            <Card>
              <h3 style={{ marginBottom: 'var(--space-sm)' }}>Architecture</h3>
              <p style={{ margin: 0 }}>{analysis.architecture}</p>
            </Card>

            {/* Features */}
            <Card>
              <h3 style={{ marginBottom: 'var(--space-md)' }}>Key Features</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                {analysis.features.map((feature, i) => (
                  <div key={i} style={{
                    padding: 'var(--space-md)',
                    background: 'var(--color-bg)',
                    border: 'var(--border-width) solid var(--color-border)',
                  }}>
                    <h4 style={{ marginBottom: 'var(--space-xs)' }}>{feature.name}</h4>
                    <p style={{ marginBottom: 'var(--space-sm)', color: '#666' }}>{feature.description}</p>
                    {feature.evidence.length > 0 && (
                      <div style={{ fontSize: 'var(--text-sm)' }}>
                        <strong>Evidence:</strong>
                        <ul style={{ margin: 'var(--space-xs) 0', paddingLeft: 'var(--space-lg)' }}>
                          {feature.evidence.map((ev, j) => (
                            <li key={j}>{ev}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            {/* Setup Steps */}
            {analysis.setupSteps.length > 0 && (
              <Card>
                <h3 style={{ marginBottom: 'var(--space-sm)' }}>Setup Steps</h3>
                <ol style={{ margin: 0, paddingLeft: 'var(--space-lg)' }}>
                  {analysis.setupSteps.map((step, i) => (
                    <li key={i} style={{ marginBottom: 'var(--space-xs)' }}>{step}</li>
                  ))}
                </ol>
              </Card>
            )}

            {/* Key Evidence */}
            {Object.keys(analysis.evidence).length > 0 && (
              <Card>
                <h3 style={{ marginBottom: 'var(--space-sm)' }}>Key Evidence</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                  {Object.entries(analysis.evidence).map(([file, content], i) => (
                    <div key={i} style={{ fontSize: 'var(--text-sm)' }}>
                      <strong>{file}:</strong> {content}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Risks */}
            {analysis.risks.length > 0 && (
              <Card style={{ background: '#fff5f5' }}>
                <h3 style={{ marginBottom: 'var(--space-sm)', color: 'var(--color-error)' }}>Potential Risks</h3>
                <ul style={{ margin: 0, paddingLeft: 'var(--space-lg)' }}>
                  {analysis.risks.map((risk, i) => (
                    <li key={i}>{risk}</li>
                  ))}
                </ul>
              </Card>
            )}

            {/* Unknowns */}
            {analysis.unknowns.length > 0 && (
              <Card style={{ background: '#fffbf0' }}>
                <h3 style={{ marginBottom: 'var(--space-sm)', color: '#856404' }}>Unknowns (Need Clarification)</h3>
                <ul style={{ margin: 0, paddingLeft: 'var(--space-lg)' }}>
                  {analysis.unknowns.map((unknown, i) => (
                    <li key={i}>{unknown}</li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', gap: 'var(--space-md)', justifyContent: 'flex-end' }}>
          {status === 'complete' && (
            <>
              <Link href={`/run/${id}`}>
                <Button variant="outline">View Progress</Button>
              </Link>
              {analysisStatus?.runId && (
                <Link href={`/storyboard/${analysisStatus.runId}`}>
                  <Button>Next: Storyboard →</Button>
                </Link>
              )}
            </>
          )}
          {(status === 'analyzing' || status === 'needs_clarification') && (
            <Button variant="outline" onClick={fetchAnalysis}>
              Refresh
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
