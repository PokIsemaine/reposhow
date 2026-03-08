'use client';

import { useState, useEffect, use, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, Badge, Progress } from '../../components/ui';
import { SceneCard } from '../../components/SceneCard';
import { AssetGenerationPanel } from '../../components/AssetGenerationPanel';
import { BgmVisualizer } from '../../components/BgmVisualizer';
import { BgmPlayer } from '../../components/BgmPlayer';

interface LogEntry {
  timestamp: string;
  level: string;
  stage?: string;
  message: string;
}

interface Storyboard {
  scenes: Array<{
    sceneNumber: number;
    durationSec: number;
    narrationText: string;
    visualPrompt: string;
    transition: string;
  }>;
  totalDurationSec: number;
}

interface RunInfo {
  runId: string;
  config: {
    repoUrl?: string;
    localPath?: string;
    duration: number;
    resolution: string;
  };
}

// Scene generation status type
type SceneGenerationStatus = 'pending' | 'generating' | 'complete' | 'error';

export default function StoryboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [runInfo, setRunInfo] = useState<RunInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [approving, setApproving] = useState(false);
  const [polling, setPolling] = useState(true);
  const [showAssetGeneration, setShowAssetGeneration] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [currentStage, setCurrentStage] = useState<string>('STORYBOARD_REVIEW');
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // BGM state
  const [bgmOptions, setBgmOptions] = useState<Array<{ music_id: string; title: string; author: string; duration_seconds: number }>>([]);
  const [selectedBgmId, setSelectedBgmId] = useState<string | null>(null);

  // Image style state - will be initialized from config after fetch
  const [selectedImageStyle, setSelectedImageStyle] = useState<string>('none');
  const [customImagePrompt, setCustomImagePrompt] = useState<string>('');
  const imageStyleInitializedRef = useRef(false);

  // Music style state - will be initialized from config after fetch
  const [selectedMusicStyle, setSelectedMusicStyle] = useState<string>('upbeat');
  const musicStyleInitializedRef = useRef(false);

  // BGM audio state
  const [bgmAudioUrl, setBgmAudioUrl] = useState<string | null>(null);
  const [bgmAudioReady, setBgmAudioReady] = useState(false);

  // Image style options
  const imageStyleOptions = [
    { value: 'none', label: 'Default (AI style)' },
    { value: 'flat-illustration', label: 'Flat Vector Illustration' },
    { value: 'tech-dashboard', label: 'Tech Dashboard' },
    { value: '3d-render', label: '3D Render' },
    { value: 'minimal', label: 'Minimal' },
    { value: 'custom', label: 'Custom' },
  ];

  // Asset state
  const [generatedImages, setGeneratedImages] = useState<Record<number, string>>({});
  const [voiceAudioUrl, setVoiceAudioUrl] = useState<string | null>(null);
  const [voiceAudioFiles, setVoiceAudioFiles] = useState<Record<number, string>>({});
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);

  // Render state
  const [assetsReady, setAssetsReady] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderingComplete, setRenderingComplete] = useState(false);

  // Scene generation status from logs
  const [sceneStatuses, setSceneStatuses] = useState<Record<number, SceneGenerationStatus>>({});
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Unified audio playback state
  const [currentPlayingScene, setCurrentPlayingScene] = useState<number | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState<number>(0);
  const [currentWordIndex, setCurrentWordIndex] = useState<number>(-1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Calculate scene time ranges from durations
  const sceneTimeRanges = storyboard?.scenes.reduce<Record<number, { start: number; end: number }>>((acc, scene, index) => {
    const prevEnd = index > 0 ? acc[storyboard.scenes[index - 1].sceneNumber].end : 0;
    acc[scene.sceneNumber] = {
      start: prevEnd,
      end: prevEnd + scene.durationSec,
    };
    return acc;
  }, {}) || {};

  // Handle play scene from child component
  const handlePlayScene = async (sceneNumber: number) => {
    // Use individual scene audio file if available, otherwise fall back to merged voice
    const sceneAudioUrl = voiceAudioFiles[sceneNumber] || voiceAudioUrl;
    if (!sceneAudioUrl) return;

    // If using individual scene audio, we don't need time range (each file is independent)
    // If using merged voice, we need time range
    const timeRange = sceneTimeRanges[sceneNumber];
    const isUsingIndividualAudio = !!voiceAudioFiles[sceneNumber];

    // If clicking the same scene that's playing, toggle pause/play
    if (currentPlayingScene === sceneNumber && audioRef.current) {
      if (audioRef.current.paused) {
        audioRef.current.play();
        setCurrentPlayingScene(sceneNumber);
      } else {
        audioRef.current.pause();
        setCurrentPlayingScene(null);
      }
      return;
    }

    // Stop current playback if any
    if (audioRef.current) {
      audioRef.current.pause();
    }

    // Create new audio element with the appropriate URL
    audioRef.current = new Audio(sceneAudioUrl);

    // Set up event listeners
    audioRef.current.onplay = () => {
      setCurrentPlayingScene(sceneNumber);
    };

    audioRef.current.onpause = () => {
      // Don't clear playing state here, we handle it in toggle
    };

    audioRef.current.onended = () => {
      setCurrentPlayingScene(null);
      setPlaybackProgress(0);
      setCurrentWordIndex(-1);
    };

    if (isUsingIndividualAudio) {
      // For individual scene audio files, progress is simpler (0 to 1 over the scene duration)
      audioRef.current.ontimeupdate = () => {
        if (!audioRef.current || !storyboard) return;
        const scene = storyboard.scenes.find(s => s.sceneNumber === sceneNumber);
        if (!scene) return;

        const currentTime = audioRef.current.currentTime;
        const sceneDuration = scene.durationSec;
        const progress = currentTime / sceneDuration;
        setPlaybackProgress(Math.min(Math.max(progress, 0), 1));

        // Calculate current word index
        const words = scene.narrationText.split(/\s+/).filter(w => w.length > 0);
        const wordsPerSecond = 2.5;
        const wordIndex = Math.min(
          Math.floor(currentTime * wordsPerSecond),
          words.length - 1
        );
        setCurrentWordIndex(Math.max(wordIndex, -1));
      };
    } else {
      // For merged voice audio, use time range based progress (original behavior)
      audioRef.current.ontimeupdate = () => {
        if (!audioRef.current || !timeRange) return;
        const currentTime = audioRef.current.currentTime;

        // Update playback progress for the current scene
        const range = sceneTimeRanges[sceneNumber];
        if (range) {
          const sceneProgress = (currentTime - range.start) / (range.end - range.start);
          setPlaybackProgress(Math.min(Math.max(sceneProgress, 0), 1));
        }

        // Calculate current word index based on scene narration
        const scene = storyboard?.scenes.find(s => s.sceneNumber === sceneNumber);
        if (scene) {
          const words = scene.narrationText.split(/\s+/).filter(w => w.length > 0);
          const wordsPerSecond = 2.5; // ~150 words/min
          const sceneElapsed = currentTime - timeRange.start;
          const wordIndex = Math.min(
            Math.floor(sceneElapsed * wordsPerSecond),
            words.length - 1
          );
          setCurrentWordIndex(Math.max(wordIndex, -1));
        }
      };

      // Start playing from the scene's start time for merged audio
      audioRef.current.currentTime = timeRange.start;
    }

    try {
      await audioRef.current.play();
    } catch (err) {
      console.error('Failed to play audio:', err);
      setCurrentPlayingScene(null);
    }
  };

  // Stop playback
  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setCurrentPlayingScene(null);
    setPlaybackProgress(0);
    setCurrentWordIndex(-1);
  };

  // Parse scene statuses from logs
  const parseSceneStatuses = (logEntries: LogEntry[]): Record<number, SceneGenerationStatus> => {
    const statuses: Record<number, SceneGenerationStatus> = {};

    logEntries.forEach(log => {
      // Check for scene image generation start
      const startMatch = log.message.match(/Generating image for scene (\d+)/);
      if (startMatch) {
        const sceneNum = parseInt(startMatch[1]);
        statuses[sceneNum] = 'generating';
      }

      // Check for scene image generation complete
      const savedMatch = log.message.match(/Saved image: scene_(\d+)\.png/);
      if (savedMatch) {
        const sceneNum = parseInt(savedMatch[1]);
        statuses[sceneNum] = 'complete';
      }

      // Check for scene image generation error
      const errorMatch = log.message.match(/Failed to generate image for scene (\d+)/);
      if (errorMatch) {
        const sceneNum = parseInt(errorMatch[1]);
        statuses[sceneNum] = 'error';
      }
    });

    return statuses;
  };

  const fetchStoryboard = async () => {
    try {
      const response = await fetch(`/api/runs/${id}/storyboard`);
      if (!response.ok) {
        throw new Error('Failed to fetch storyboard');
      }
      const data = await response.json();
      setStoryboard(data.storyboard);

      // Also fetch run info
      const statusResponse = await fetch(`/api/runs/${id}/status`);
      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        setRunInfo({
          runId: id,
          config: statusData.config,
        });
        setCurrentStage(statusData.stage);
        setLogs(statusData.logs || []);

        // Initialize image style from config (only once)
        if (!imageStyleInitializedRef.current && statusData.config) {
          const configImageStyle = statusData.config.imagePromptStyle || 'none';
          const configCustomPrompt = statusData.config.customImagePrompt || '';
          setSelectedImageStyle(configImageStyle);
          setCustomImagePrompt(configCustomPrompt);
          imageStyleInitializedRef.current = true;
        }

        // Initialize music style from config (only once)
        if (!musicStyleInitializedRef.current && statusData.config) {
          const configBgmPreset = statusData.config.bgmPreset || 'upbeat';
          setSelectedMusicStyle(configBgmPreset);
          musicStyleInitializedRef.current = true;
        }

        // Parse scene statuses from logs
        const parsedStatuses = parseSceneStatuses(statusData.logs || []);
        setSceneStatuses(parsedStatuses);

        // If stage is not in allowed list, redirect back to run page
        const allowedStages = ['STORYBOARD_REVIEW', 'ASSETS', 'ASSETS_COMPLETE', 'RENDER', 'COMPLETED'];
        if (!allowedStages.includes(statusData.stage) && polling) {
          setPolling(false);
          router.push(`/run/${id}`);
        }

        // Check if already in ASSETS_COMPLETE stage (assets ready)
        if (statusData.stage === 'ASSETS_COMPLETE') {
          setShowAssetGeneration(true);
        }

        // Check if already rendering
        if (statusData.stage === 'RENDER') {
          setShowAssetGeneration(true);
          setIsRendering(true);
        }

        // If assets already exist, load them
        if (statusData.artifacts) {
          // Load generated images
          if (statusData.artifacts.images && Array.isArray(statusData.artifacts.images)) {
            const images: Record<number, string> = {};
            statusData.artifacts.images.forEach((img: string, index: number) => {
              images[index + 1] = `/api/runs/${id}/assets/${img}`;
            });
            setGeneratedImages(images);

            // Update scene statuses based on available images
            Object.keys(images).forEach(sceneNum => {
              if (!parsedStatuses[parseInt(sceneNum)]) {
                parsedStatuses[parseInt(sceneNum)] = 'complete';
              }
            });
            setSceneStatuses(parsedStatuses);
          }

          // Load voice audio
          if (statusData.artifacts.voiceAudio) {
            setVoiceAudioUrl(`/api/runs/${id}/assets/${statusData.artifacts.voiceAudio}`);
          }

          // Load individual scene audio files
          if (statusData.artifacts.voiceAudioFiles && Array.isArray(statusData.artifacts.voiceAudioFiles)) {
            const files: Record<number, string> = {};
            statusData.artifacts.voiceAudioFiles.forEach((filename: string) => {
              const match = filename.match(/voice_(\d+)\.wav/);
              if (match) {
                files[parseInt(match[1])] = `/api/runs/${id}/assets/${filename}`;
              }
            });
            setVoiceAudioFiles(files);
          }

          // Load BGM audio
          if (statusData.artifacts.bgmAudio) {
            setBgmAudioUrl(`/api/runs/${id}/assets/${statusData.artifacts.bgmAudio}`);
          }
        }

        // If already in asset generation, show the panel
        if (statusData.stage === 'ASSET_GENERATION' || statusData.stage === 'RENDERING') {
          setShowAssetGeneration(true);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load storyboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStoryboard();
  }, [id]);

  // Wait for BGM file to be fully written with timeout
  const waitForFile = async (url: string, timeoutMs: number): Promise<boolean> => {
    const startTime = Date.now();
    const pollInterval = 1500;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' }
        });
        if (response.ok) {
          const contentRange = response.headers.get('Content-Range');
          if (contentRange) {
            const match = contentRange.match(/\/(\d+)$/);
            if (match && parseInt(match[1], 10) > 0) {
              return true;
            }
          }
        }
      } catch (e) {
        // Continue waiting on error
      }
      await new Promise(r => setTimeout(r, pollInterval));
    }
    return false; // Timeout
  };

  // Verify BGM audio is accessible and fully written when URL changes
  useEffect(() => {
    if (!bgmAudioUrl) {
      setBgmAudioReady(false);
      return;
    }

    let isMounted = true;
    const timeoutMs = 180000; // 3 minutes max wait

    const verifyAudio = async () => {
      if (!isMounted) return;

      console.log('[BGM Verify] Starting file verification...');
      const fileReady = await waitForFile(bgmAudioUrl, timeoutMs);

      if (!isMounted) return;

      if (fileReady) {
        console.log('[BGM Verify] File is ready');
        setBgmAudioReady(true);
      } else {
        console.warn('[BGM Verify] Timeout waiting for file');
        // Don't set ready to false - let BgmPlayer handle the retry
      }
    };

    // Start verification with initial delay to allow file generation to start
    const initialDelay = setTimeout(() => {
      verifyAudio();
    }, 1000);

    return () => {
      isMounted = false;
      clearTimeout(initialDelay);
    };
  }, [bgmAudioUrl]);

  // Poll for updates when in asset generation
  useEffect(() => {
    if (!showAssetGeneration || !polling) return;

    const interval = setInterval(() => {
      fetchStoryboard();
    }, 2000);

    return () => clearInterval(interval);
  }, [showAssetGeneration, polling, id]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Check if assets are ready
  useEffect(() => {
    if (storyboard) {
      const allImagesGenerated = Object.keys(generatedImages).length === storyboard.scenes.length;
      const hasVoice = !!voiceAudioUrl;
      const hasBgm = !!bgmAudioUrl;
      // Also check if stage is already ASSETS_COMPLETE
      const isAssetsComplete = currentStage === 'ASSETS_COMPLETE';
      setAssetsReady((allImagesGenerated && hasVoice && hasBgm) || isAssetsComplete);
    }
  }, [generatedImages, voiceAudioUrl, bgmAudioUrl, storyboard, currentStage]);

  // Poll for rendering completion when isRendering is true
  useEffect(() => {
    if (!isRendering || !polling) return;

    const checkRenderStatus = async () => {
      try {
        const response = await fetch(`/api/runs/${id}/status`);
        if (response.ok) {
          const data = await response.json();
          if (data.stage === 'COMPLETED') {
            setRenderingComplete(true);
            setIsRendering(false);
            setCurrentStage('COMPLETED');
            // Don't redirect immediately - let user view logs on this page
            // User can click "View Result" button to go to result page
          } else if (data.stage === 'RENDERING') {
            setCurrentStage(data.stage);
            setLogs(data.logs || []);
          }
        }
      } catch (err) {
        console.error('Failed to check render status:', err);
      }
    };

    const interval = setInterval(checkRenderStatus, 2000);
    return () => clearInterval(interval);
  }, [isRendering, polling, id, router]);

  // Fetch music options
  useEffect(() => {
    const fetchMusic = async () => {
      try {
        const response = await fetch('/api/music');
        const data = await response.json();
        setBgmOptions(data.music || []);
      } catch (error) {
        console.error('Failed to fetch music library:', error);
      }
    };
    fetchMusic();
  }, []);

  const handleSceneUpdate = async (sceneNumber: number, updates: Record<string, unknown>) => {
    if (!storyboard) return;

    try {
      const response = await fetch(`/api/runs/${id}/storyboard`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenes: [{ sceneNumber, ...updates }],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update scene');
      }

      const data = await response.json();
      setStoryboard(data.storyboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update scene');
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    try {
      const response = await fetch(`/api/runs/${id}/storyboard/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bgmMusicId: selectedBgmId,
          imagePromptStyle: selectedImageStyle,
          customImagePrompt: selectedImageStyle === 'custom' ? customImagePrompt : '',
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to approve storyboard');
      }

      // Show asset generation panel instead of redirecting
      setShowAssetGeneration(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve storyboard');
      setApproving(false);
    }
  };

  const handleAssetGenerationComplete = () => {
    // If assets are ready and user wants to render, stay on page and wait for render
    if (assetsReady && !isRendering) {
      // Don't redirect, user can click "Render Video" button
      return;
    }
    // Otherwise redirect to run page for rendering phase
    router.push(`/run/${id}`);
  };

  const handleRenderVideoClick = () => {
    // Start rendering
    setIsRendering(true);
    // Trigger the rendering process via API
    fetch(`/api/runs/${id}/render`, { method: 'POST' }).catch(err => {
      console.error('Failed to start render:', err);
      setIsRendering(false);
    });
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        Loading storyboard...
      </div>
    );
  }

  if (error && !storyboard) {
    return (
      <div style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-error)' }}>{error}</p>
        <Button onClick={() => router.push('/')} style={{ marginTop: 'var(--space-md)' }}>
          Go Home
        </Button>
      </div>
    );
  }

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    padding: 'var(--space-xl) var(--space-md)',
  };

  const headerStyle: React.CSSProperties = {
    maxWidth: '1200px',
    margin: '0 auto var(--space-xl)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 'var(--space-md)',
  };

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: 'var(--space-lg)',
    maxWidth: '1200px',
    margin: '0 auto',
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <h1 style={{ margin: 0 }}>Storyboard Studio</h1>
          <p style={{ margin: 'var(--space-sm) 0 0', color: '#666' }}>
            {runInfo?.config?.repoUrl || runInfo?.config?.localPath || id}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <Badge variant={renderingComplete ? 'success' : isRendering ? 'default' : assetsReady ? 'success' : showAssetGeneration ? 'default' : 'warning'}>
            {renderingComplete ? 'Completed' : isRendering ? 'Rendering...' : assetsReady ? 'Assets Ready' : showAssetGeneration ? 'Generating...' : 'Review Mode'}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLogs(!showLogs)}
            title={showLogs ? 'Hide Logs' : 'Show Logs'}
          >
            📋 Logs {showLogs ? '▲' : '▼'}
          </Button>
          <Link href="/projects">
            <Button variant="outline" size="sm">Projects</Button>
          </Link>
        </div>
      </div>

      {/* Summary Card */}
      <div style={{ maxWidth: '1200px', margin: '0 auto var(--space-xl)' }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-lg)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-xl)', flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: 'var(--text-xs)', color: '#666' }}>Scenes</span>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xl)', fontWeight: 700 }}>
                  {storyboard?.scenes.length || 0}
                </p>
              </div>
              <div>
                <span style={{ fontSize: 'var(--text-xs)', color: '#666' }}>Total Duration</span>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xl)', fontWeight: 700 }}>
                  {storyboard?.totalDurationSec || 0}s
                </p>
              </div>
              <div>
                <span style={{ fontSize: 'var(--text-xs)', color: '#666' }}>Target Duration</span>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xl)', fontWeight: 700 }}>
                  {runInfo?.config?.duration || 0}s
                </p>
              </div>
              {/* Show asset status if available */}
              {Object.keys(generatedImages).length > 0 && (
                <div>
                  <span style={{ fontSize: 'var(--text-xs)', color: '#666' }}>Images</span>
                  <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-success)' }}>
                    {Object.keys(generatedImages).length}/{storyboard?.scenes.length || 0}
                  </p>
                </div>
              )}
              {voiceAudioUrl && (
                <div>
                  <span style={{ fontSize: 'var(--text-xs)', color: '#666' }}>Voice</span>
                  <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-success)' }}>
                    Ready
                  </p>
                </div>
              )}
              {/* BGM Player - only show when BGM audio is ready (verified accessible) */}
              {showAssetGeneration && bgmAudioReady && bgmAudioUrl && (
                <BgmPlayer
                  audioUrl={bgmAudioUrl}
                  isGenerating={false}
                />
              )}
            </div>

            {/* Image Style Selector - only show when not in asset generation mode */}
            {!showAssetGeneration && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: '180px' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: '#666' }}>Image Style</span>
                <select
                  value={selectedImageStyle}
                  onChange={(e) => {
                    setSelectedImageStyle(e.target.value);
                    if (e.target.value !== 'custom') setCustomImagePrompt('');
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '2px solid #000',
                    fontSize: 'var(--text-sm)',
                    backgroundColor: '#fff',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {imageStyleOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {selectedImageStyle === 'custom' && (
                  <textarea
                    value={customImagePrompt}
                    onChange={(e) => setCustomImagePrompt(e.target.value)}
                    placeholder="Enter custom image style prompt..."
                    style={{
                      marginTop: '4px',
                      width: '100%',
                      minHeight: '60px',
                      padding: '8px',
                      borderRadius: 'var(--radius-sm)',
                      border: '2px solid #000',
                      fontSize: 'var(--text-xs)',
                      fontFamily: 'inherit',
                      resize: 'vertical',
                    }}
                  />
                )}
              </div>
            )}

            {/* BGM Visualizer - only show when not in asset generation mode */}
            {!showAssetGeneration && (
              <>
                <BgmVisualizer
                  track={selectedBgmId ? bgmOptions.find(m => m.music_id === selectedBgmId) || null : null}
                  bgmOptions={bgmOptions}
                  onSelect={(musicId) => setSelectedBgmId(musicId)}
                />
                {!assetsReady && (
                  <Button
                    onClick={handleApprove}
                    disabled={approving}
                    style={{ minWidth: '200px' }}
                  >
                    {approving ? 'Approving...' : 'Generate Assets'}
                  </Button>
                )}
              </>
            )}
            {/* Show View Result button when rendering is complete */}
            {currentStage === 'COMPLETED' ? (
              <Link href={`/result/${id}`}>
                <Button style={{ minWidth: '200px' }}>
                  View Result
                </Button>
              </Link>
            ) : showAssetGeneration && assetsReady && !isRendering && !renderingComplete ? (
              <Button
                onClick={handleRenderVideoClick}
                style={{ minWidth: '200px' }}
              >
                Render Video
              </Button>
            ) : null}
            {isRendering && (
              <Button
                disabled
                style={{ minWidth: '200px', opacity: 0.7 }}
              >
                Rendering...
              </Button>
            )}
          </div>
        </Card>
      </div>

      {/* Error Message */}
      {error && !showAssetGeneration && (
        <div style={{ maxWidth: '1200px', margin: '0 auto var(--space-lg)' }}>
          <Card style={{ background: '#fff5f5', borderColor: 'var(--color-error)' }}>
            <p style={{ color: 'var(--color-error)', margin: 0 }}>{error}</p>
          </Card>
        </div>
      )}

      {/* Collapsible Log Panel - shown when generating */}
      {showLogs && (
        <div style={{ maxWidth: '1200px', margin: '0 auto var(--space-md)' }}>
          <Card>
            <div
              ref={logContainerRef}
              style={{
                height: '200px',
                overflowY: 'auto',
                background: '#1a1a2e',
                color: '#eee',
                padding: 'var(--space-md)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'monospace',
                fontSize: 'var(--text-xs)',
              }}
            >
              {logs.slice(-30).map((log, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: '4px',
                    color: log.level === 'ERROR' ? '#ff6b6b' : log.level === 'WARN' ? '#ffd93d' : '#aaa',
                  }}
                >
                  <span style={{ color: '#666', marginRight: '8px' }}>
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                  </span>
                  <span style={{ color: '#4ecdc4' }}>[{log.stage}]</span>
                  <span style={{ marginLeft: '8px' }}>{log.message}</span>
                </div>
              ))}
              {logs.length === 0 && <div style={{ color: '#666' }}>Waiting for logs...</div>}
            </div>
          </Card>
        </div>
      )}

      {/* Asset Generation Status - Shown inline instead of separate panel */}
      {showAssetGeneration ? (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

          {/* Scene Grid with generation status */}
          <div style={{ ...gridStyle, marginTop: 'var(--space-lg)' }}>
            {storyboard?.scenes.map((scene, index) => (
              <SceneCard
                key={scene.sceneNumber}
                scene={scene}
                sceneIndex={index}
                imageUrl={generatedImages[scene.sceneNumber]}
                voiceAudioUrl={voiceAudioUrl || undefined}
                isGeneratingAudio={isGeneratingAudio}
                generationStatus={generatedImages[scene.sceneNumber] ? 'complete' : sceneStatuses[scene.sceneNumber] || 'pending'}
                onUpdate={(updates) => handleSceneUpdate(scene.sceneNumber, updates)}
                isCurrentScenePlaying={currentPlayingScene === scene.sceneNumber}
                playbackProgress={currentPlayingScene === scene.sceneNumber ? playbackProgress : 0}
                currentWordIndex={currentPlayingScene === scene.sceneNumber ? currentWordIndex : -1}
                onPlayScene={handlePlayScene}
              />
            ))}
          </div>
        </div>
      ) : (
        /* Scene Grid (Normal review mode) */
        <div style={gridStyle}>
          {storyboard?.scenes.map((scene, index) => (
            <SceneCard
              key={scene.sceneNumber}
              scene={scene}
              sceneIndex={index}
              imageUrl={generatedImages[scene.sceneNumber]}
              voiceAudioUrl={voiceAudioUrl || undefined}
              isGeneratingAudio={isGeneratingAudio}
              generationStatus={generatedImages[scene.sceneNumber] ? 'complete' : 'pending'}
              onUpdate={(updates) => handleSceneUpdate(scene.sceneNumber, updates)}
              isCurrentScenePlaying={currentPlayingScene === scene.sceneNumber}
              playbackProgress={currentPlayingScene === scene.sceneNumber ? playbackProgress : 0}
              currentWordIndex={currentPlayingScene === scene.sceneNumber ? currentWordIndex : -1}
              onPlayScene={handlePlayScene}
            />
          ))}
        </div>
      )}
    </div>
  );
}
