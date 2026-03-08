'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface BgmPlayerProps {
  audioUrl: string;
  isGenerating?: boolean;
}

/**
 * BGM Player with waveform visualization
 * Uses Web Audio API to analyze and visualize audio frequency data
 */
export function BgmPlayer({ audioUrl, isGenerating = false }: BgmPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

  // Track consecutive errors for retry logic
  const errorCountRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Format time in mm:ss
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Initialize audio context and analyser
  const initAudioContext = useCallback(() => {
    if (!audioRef.current || isInitializedRef.current) return;

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const source = audioContext.createMediaElementSource(audioRef.current);
      source.connect(analyser);
      analyser.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;
      isInitializedRef.current = true;
    } catch (err) {
      console.error('Failed to initialize audio context:', err);
    }
  }, []);

  // Draw waveform visualization
  const drawWaveform = useCallback(() => {
    if (!analyserRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      if (!analyserRef.current) return;

      analyserRef.current.getByteFrequencyData(dataArray);

      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

        // Gradient from primary to secondary color
        const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
        gradient.addColorStop(0, '#667eea');
        gradient.addColorStop(1, '#764ba2');

        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);

        x += barWidth;
      }
    };

    draw();
  }, []);

  // Handle audio events
  useEffect(() => {
    // Skip audio initialization when generating or no URL
    if (isGenerating || !audioUrl) {
      return;
    }

    // Reset state on URL change
    errorCountRef.current = 0;
    hasLoadedRef.current = false;
    setError(null);
    setIsLoading(true);

    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.src = audioUrl;

    // Retry logic for recoverable errors
    const retryLoad = () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      errorCountRef.current++;
      console.warn(`[BgmPlayer] Retrying audio load (attempt ${errorCountRef.current})...`);
      audio.load();
    };

    audio.onloadedmetadata = () => {
      // Mark as loaded - this takes precedence over errors
      hasLoadedRef.current = true;

      // Check for valid duration (not Infinity)
      if (!isFinite(audio.duration) || audio.duration === 0) {
        console.warn('[BgmPlayer] Invalid duration detected, may retry...');
        // For error code 4, retry once after a short delay
        if (errorCountRef.current < 2) {
          retryTimeoutRef.current = setTimeout(retryLoad, 500);
          return;
        }
      }

      console.log('[BgmPlayer] Audio loaded successfully, duration:', audio.duration);
      setDuration(audio.duration);
      setIsLoading(false);
    };

    audio.onerror = (e) => {
      // If audio already loaded successfully, ignore the error (race condition)
      if (hasLoadedRef.current) {
        console.warn('[BgmPlayer] Ignoring error - audio already loaded');
        return;
      }

      const audioElement = (e as Event).target as HTMLAudioElement;
      const mediaError = audioElement?.error;
      console.warn('[BgmPlayer] Audio load warning:', mediaError);
      console.warn('[BgmPlayer] Audio URL:', audioUrl);
      console.warn('[BgmPlayer] Error code:', mediaError?.code);
      console.warn('[BgmPlayer] Error message:', mediaError?.message);

      // Handle error code 4 (MEDIA_ERR_SRC_NOT_SUPPORTED) with retry logic
      if (mediaError?.code === 4) {
        // Error code 4 can be a race condition - retry up to 2 times
        if (errorCountRef.current < 2) {
          console.warn('[BgmPlayer] Error code 4 detected - scheduling retry...');
          retryTimeoutRef.current = setTimeout(retryLoad, 500);
          return;
        }
        // After retries, check if we can still play
        console.warn('[BgmPlayer] Retries exhausted, checking if audio is playable...');
      }

      // Check for network/CORS issues only on first error
      if (errorCountRef.current === 0) {
        fetch(audioUrl, { method: 'HEAD' })
          .then(res => {
            console.warn('[BgmPlayer] Response status:', res.status);
            console.warn('[BgmPlayer] Content-Type header:', res.headers.get('content-type'));
          })
          .catch(err => {
            console.warn('[BgmPlayer] Fetch error (CORS?):', err);
          });
      }

      // Only set error after multiple consecutive failures
      errorCountRef.current++;
      if (errorCountRef.current >= 3) {
        let errorMessage = 'Failed to load audio';
        if (mediaError?.code === 4) {
          errorMessage = 'Audio format not supported or CORS blocked';
        } else if (mediaError?.code === 2) {
          errorMessage = 'Network error loading audio';
        } else if (mediaError?.message) {
          errorMessage = `Failed to load audio: ${mediaError.message}`;
        }
        setError(errorMessage);
        setIsLoading(false);
      }
    };

    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime);
    };

    audio.onended = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audioRef.current = audio;

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      audio.pause();
      audio.src = '';
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [audioUrl]);

  // Start/stop visualization based on playback state
  useEffect(() => {
    if (isPlaying && !isInitializedRef.current) {
      initAudioContext();
      // Start visualization after a short delay to allow context to initialize
      setTimeout(() => {
        drawWaveform();
      }, 100);
    } else if (!isPlaying && animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
  }, [isPlaying, initAudioContext, drawWaveform]);

  const togglePlayPause = async () => {
    if (!audioRef.current) return;

    // Resume audio context if suspended (required by browsers)
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
        // Initialize and start visualization if not already done
        if (!isInitializedRef.current) {
          initAudioContext();
          setTimeout(() => drawWaveform(), 100);
        }
      } catch (err) {
        console.error('Failed to play audio:', err);
        setError('Failed to play audio');
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!audioRef.current) return;
    const time = parseFloat(e.target.value);
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (isLoading || isGenerating) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-sm)',
          minWidth: '200px',
        }}
      >
        <span style={{ fontSize: 'var(--text-xs)', color: '#666' }}>BGM</span>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            padding: 'var(--space-sm)',
            background: '#f9f9f9',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-primary)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            🎵
          </div>
          <span style={{ fontSize: 'var(--text-sm)', color: '#666' }}>
            {isGenerating ? 'Generating BGM...' : 'Loading...'}
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-sm)',
          minWidth: '200px',
        }}
      >
        <span style={{ fontSize: 'var(--text-xs)', color: '#666' }}>BGM</span>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            padding: 'var(--space-sm)',
            background: '#fff5f5',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-error)',
          }}
        >
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm)',
        minWidth: '240px',
      }}
    >
      <span style={{ fontSize: 'var(--text-xs)', color: '#666' }}>BGM</span>

      {/* Player Container */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-sm)',
          padding: 'var(--space-sm)',
          background: '#f9f9f9',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* Play/Pause Button */}
        <button
          onClick={togglePlayPause}
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'var(--color-primary)',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            flexShrink: 0,
            transition: 'transform 0.1s ease',
          }}
          onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
          onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        {/* Waveform Canvas */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <canvas
            ref={canvasRef}
            width={120}
            height={36}
            style={{
              width: '100%',
              height: '36px',
              borderRadius: 'var(--radius-sm)',
              display: 'block',
            }}
          />
        </div>

        {/* Time Display */}
        <div
          style={{
            fontSize: 'var(--text-xs)',
            color: '#666',
            whiteSpace: 'nowrap',
            minWidth: '40px',
            textAlign: 'right',
          }}
        >
          {formatTime(currentTime)}/{formatTime(duration)}
        </div>
      </div>

      {/* Progress Bar */}
      <input
        type="range"
        min={0}
        max={duration || 100}
        value={currentTime}
        onChange={handleSeek}
        style={{
          width: '100%',
          height: '4px',
          borderRadius: '2px',
          appearance: 'none',
          background: `linear-gradient(to right, var(--color-primary) ${progress}%, #e0e0e0 ${progress}%)`,
          cursor: 'pointer',
          outline: 'none',
        }}
      />
    </div>
  );
}
