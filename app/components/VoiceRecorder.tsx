'use client';

import { useState, useRef, useEffect } from 'react';
import { Button, Card } from './ui';

interface VoiceRecorderProps {
  onRecordingComplete: (audioBase64: string) => void;
  disabled?: boolean;
}

// Prompt text for the user to read
const RECORDING_PROMPT = "Hello, welcome to my project. This is a sample voice recording for voice cloning. Please speak clearly so the AI can learn my voice patterns.";

export default function VoiceRecorder({ onRecordingComplete, disabled = false }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);

        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          // Remove data URL prefix to get raw base64
          const base64Data = base64.split(',')[1];
          setAudioBase64(base64Data);
          onRecordingComplete(base64Data);
        };
        reader.readAsDataURL(blob);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      setError('Could not access microphone. Please check permissions.');
      console.error('Recording error:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const togglePlayback = () => {
    if (!audioRef.current || !audioUrl) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handlePlaybackEnded = () => {
    setIsPlaying(false);
  };

  const reRecord = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setAudioBase64(null);
    setRecordingTime(0);
    setIsPlaying(false);
    setError(null);
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-md)',
  };

  const promptStyle: React.CSSProperties = {
    padding: 'var(--space-md)',
    background: 'var(--color-bg-secondary)',
    border: 'var(--border-width) solid var(--color-border)',
    fontSize: 'var(--text-sm)',
    lineHeight: 1.6,
  };

  const recordingIndicatorStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    color: 'var(--color-error)',
    fontWeight: 700,
  };

  const dotStyle: React.CSSProperties = {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    background: 'var(--color-error)',
    animation: 'pulse 1s infinite',
  };

  const waveformStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    height: '60px',
  };

  const waveformBarStyle = (index: number, active: boolean): React.CSSProperties => ({
    width: '4px',
    height: active ? `${20 + Math.random() * 30}px` : '20px',
    background: active ? 'var(--color-primary)' : 'var(--color-border)',
    borderRadius: '2px',
    transition: 'height 0.1s ease',
  });

  const buttonRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--space-sm)',
    justifyContent: 'center',
  };

  return (
    <div style={containerStyle}>
      {/* Recording prompt */}
      <div style={promptStyle}>
        <strong>Recording Guide:</strong>
        <p style={{ marginTop: 'var(--space-xs)' }}>{RECORDING_PROMPT}</p>
        <p style={{ marginTop: 'var(--space-sm)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
          Tip: Record for at least 30 seconds. Longer recordings (1+ minute) produce better results.
        </p>
      </div>

      {/* Error message */}
      {error && (
        <Card style={{ background: '#fff5f5', borderColor: 'var(--color-error)' }}>
          <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>{error}</p>
        </Card>
      )}

      {/* Recording visualization */}
      {isRecording && (
        <div style={waveformStyle}>
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              style={waveformBarStyle(i, true)}
            />
          ))}
        </div>
      )}

      {/* Recording status */}
      {isRecording && (
        <div style={recordingIndicatorStyle}>
          <div style={dotStyle} />
          <span>Recording... {formatTime(recordingTime)}</span>
        </div>
      )}

      {/* Playback status */}
      {audioUrl && !isRecording && (
        <div style={{ textAlign: 'center' }}>
          <audio
            ref={audioRef}
            src={audioUrl}
            onEnded={handlePlaybackEnded}
          />
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-success)' }}>
            Recording complete ({formatTime(recordingTime)})
          </p>
        </div>
      )}

      {/* Control buttons */}
      <div style={buttonRowStyle}>
        {!audioUrl ? (
          isRecording ? (
            <Button onClick={stopRecording} disabled={disabled}>
              Stop Recording
            </Button>
          ) : (
            <Button onClick={startRecording} disabled={disabled}>
              Start Recording
            </Button>
          )
        ) : (
          <>
            <Button
              onClick={togglePlayback}
              variant="outline"
              disabled={disabled}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </Button>
            <Button
              onClick={reRecord}
              variant="outline"
              disabled={disabled}
            >
              Re-record
            </Button>
          </>
        )}
      </div>

      {/* Recording requirement hint */}
      {!audioUrl && !isRecording && (
        <p style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
          Click "Start Recording" to begin. Minimum 30 seconds recommended.
        </p>
      )}

      {/* Hidden audio element for playback */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onEnded={() => setIsPlaying(false)}
        />
      )}
    </div>
  );
}
