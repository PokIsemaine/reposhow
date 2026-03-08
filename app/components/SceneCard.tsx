'use client';

import { useState, useRef, useEffect } from 'react';
import { Card, Button, Textarea, Input } from './ui';

interface Scene {
  sceneNumber: number;
  durationSec: number;
  narrationText: string;
  visualPrompt: string;
  transition: string;
}

interface SceneCardProps {
  scene: Scene;
  sceneIndex: number;
  imageUrl?: string;
  voiceAudioUrl?: string;
  isGeneratingAudio?: boolean;
  generationStatus?: 'pending' | 'generating' | 'complete' | 'error';
  onUpdate: (updates: Partial<Scene>) => void;
  isCurrentScenePlaying?: boolean;
  playbackProgress?: number;
  currentWordIndex?: number;
  onPlayScene?: (sceneNumber: number) => void;
}

export function SceneCard({
  scene,
  sceneIndex,
  imageUrl,
  voiceAudioUrl,
  isGeneratingAudio,
  generationStatus = 'pending',
  onUpdate,
  isCurrentScenePlaying = false,
  playbackProgress = 0,
  currentWordIndex = -1,
  onPlayScene,
}: SceneCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedScene, setEditedScene] = useState(scene);
  const [isSaving, setIsSaving] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      onUpdate({
        visualPrompt: editedScene.visualPrompt,
        durationSec: editedScene.durationSec,
      });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedScene(scene);
    setIsEditing(false);
  };

  // Render narration text with word highlighting
  const renderNarrationWithHighlight = () => {
    if (currentWordIndex < 0 || !isCurrentScenePlaying) {
      return scene.narrationText;
    }

    const words = scene.narrationText.split(/(\s+)/); // Split by whitespace but keep separators
    let wordIndex = 0;

    return (
      <>
        {words.map((word, i) => {
          // Only count non-whitespace words for highlighting
          if (word.trim()) {
            const isHighlighted = wordIndex === currentWordIndex;
            const isPast = wordIndex < currentWordIndex;
            wordIndex++;

            return (
              <span
                key={i}
                style={{
                  backgroundColor: isHighlighted
                    ? 'var(--color-primary)'
                    : isPast
                      ? 'rgba(0, 122, 255, 0.2)'
                      : 'transparent',
                  color: isHighlighted ? 'white' : 'inherit',
                  padding: isHighlighted ? '1px 2px' : '1px 0',
                  borderRadius: '2px',
                  transition: 'all 0.1s ease',
                }}
              >
                {word}
              </span>
            );
          }
          return <span key={i}>{word}</span>;
        })}
      </>
    );
  };

  // Audio playback handlers
  const handlePlayAudio = async () => {
    // If parent provides onPlayScene callback, use it
    if (onPlayScene) {
      onPlayScene(scene.sceneNumber);
      return;
    }

    // Fallback to local audio playback (legacy behavior)
    setAudioError(null);

    if (!audioRef.current && voiceAudioUrl) {
      audioRef.current = new Audio(voiceAudioUrl);
      audioRef.current.onended = () => setIsPlayingAudio(false);
      audioRef.current.onerror = () => {
        setAudioError('Audio not ready yet. Please wait for generation to complete.');
        setIsPlayingAudio(false);
      };
      // Preload the audio
      audioRef.current.load();
    }

    if (audioRef.current) {
      if (isPlayingAudio) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setIsPlayingAudio(false);
      } else {
        // Check if audio is ready to play
        if (audioRef.current.readyState >= 2) {
          // HAVE_CURRENT_DATA or more
          try {
            await audioRef.current.play();
            setIsPlayingAudio(true);
          } catch (err) {
            setAudioError('Failed to play audio. Please try again.');
          }
        } else {
          // Wait for canplaythrough event
          try {
            await new Promise<void>((resolve, reject) => {
              const onCanPlay = () => {
                audioRef.current?.removeEventListener('canplaythrough', onCanPlay);
                audioRef.current?.removeEventListener('error', onError);
                resolve();
              };
              const onError = () => {
                audioRef.current?.removeEventListener('canplaythrough', onCanPlay);
                audioRef.current?.removeEventListener('error', onError);
                reject(new Error('Audio load failed'));
              };
              audioRef.current?.addEventListener('canplaythrough', onCanPlay);
              audioRef.current?.addEventListener('error', onError);
            });
            await audioRef.current.play();
            setIsPlayingAudio(true);
          } catch (err) {
            setAudioError('Failed to play audio. Please try again.');
          }
        }
      }
    }
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Render different content based on generation status
  const renderImageArea = () => {
    if (generationStatus === 'generating') {
      return (
        <div
          style={{
            width: '100%',
            aspectRatio: '16/9',
            background: 'linear-gradient(135deg, #e0e0e0 25%, #f5f5f5 50%, #e0e0e0 75%)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-md)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 'var(--space-sm)',
            position: 'relative',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              border: '3px solid #ddd',
              borderTopColor: 'var(--color-primary)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
          <span style={{ color: '#666', fontSize: 'var(--text-sm)' }}>Generating...</span>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      );
    }

    if (generationStatus === 'error') {
      return (
        <div
          style={{
            width: '100%',
            aspectRatio: '16/9',
            background: '#fff5f5',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 'var(--space-sm)',
            border: '2px solid var(--color-error)',
          }}
        >
          <span style={{ fontSize: '24px' }}>❌</span>
          <span style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>Failed</span>
        </div>
      );
    }

    if (generationStatus === 'complete') {
      return (
        <div
          onClick={() => imageUrl && setIsImageModalOpen(true)}
          style={{
            width: '100%',
            aspectRatio: '16/9',
            background: imageUrl ? `url(${imageUrl}) center/cover` : 'linear-gradient(135deg, #e0e0e0 25%, #f5f5f5 50%, #e0e0e0 75%)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-md)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            padding: 'var(--space-sm)',
            cursor: imageUrl ? 'zoom-in' : 'default',
          }}
        >
          <span
            style={{
              background: 'rgba(0,0,0,0.6)',
              color: 'white',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
            }}
          >
            ✅ Generated
          </span>
        </div>
      );
    }

    // pending
    return (
      <div
        style={{
          width: '100%',
          aspectRatio: '16/9',
          background: 'linear-gradient(135deg, #e0e0e0 25%, #f5f5f5 50%, #e0e0e0 75%)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-md)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999',
          fontSize: 'var(--text-sm)',
        }}
      >
        ⏳ Pending
      </div>
    );
  };

  return (
    <Card style={{ padding: 'var(--space-md)', position: 'relative', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* Scene Image Placeholder */}
      {renderImageArea()}

      {/* Content wrapper with flex to push buttons to bottom */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>

      {/* Scene Number and Duration */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-sm)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>
          Scene {scene.sceneNumber}
        </h3>
        <span
          style={{
            background: 'var(--color-primary)',
            color: 'white',
            padding: '2px 8px',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {scene.durationSec}s
        </span>
      </div>

      {/* Narration Text (read-only) with audio playback */}
      <div style={{ marginBottom: 'var(--space-md)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <label style={{ fontSize: 'var(--text-xs)', color: '#666' }}>
            Narration
          </label>
          {voiceAudioUrl ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handlePlayAudio}
              disabled={isGeneratingAudio}
              style={{ padding: '4px 8px', fontSize: 'var(--text-xs)', minHeight: 'auto' }}
            >
              {isGeneratingAudio ? '⏳' : isCurrentScenePlaying ? '⏸' : '🔊'} {isCurrentScenePlaying ? 'Stop' : 'Play'}
            </Button>
          ) : isGeneratingAudio ? (
            <span style={{ fontSize: 'var(--text-xs)', color: '#999' }}>Generating...</span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled
              style={{ padding: '4px 8px', fontSize: 'var(--text-xs)', minHeight: 'auto' }}
            >
              🎤 Generate
            </Button>
          )}
        </div>
        {audioError && (
          <div style={{ color: 'var(--color-error)', fontSize: 'var(--text-xs)', marginTop: '4px' }}>
            {audioError}
          </div>
        )}
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
          {renderNarrationWithHighlight()}
        </p>
      </div>

      {/* Editable Fields */}
      {isEditing ? (
        <>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label style={{ fontSize: 'var(--text-xs)', color: '#666', display: 'block', marginBottom: '4px' }}>
              Visual Prompt
            </label>
            <Textarea
              value={editedScene.visualPrompt}
              onChange={(e) => setEditedScene({ ...editedScene, visualPrompt: e.target.value })}
              placeholder="Description for AI image generation"
              rows={3}
            />
          </div>

          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label style={{ fontSize: 'var(--text-xs)', color: '#666', display: 'block', marginBottom: '4px' }}>
              Duration (seconds)
            </label>
            <Input
              type="number"
              min={5}
              max={30}
              value={editedScene.durationSec}
              onChange={(e) => setEditedScene({ ...editedScene, durationSec: parseInt(e.target.value) || 10 })}
            />
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginTop: 'auto' }}>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label style={{ fontSize: 'var(--text-xs)', color: '#666', display: 'block', marginBottom: '4px' }}>
              Visual Prompt
            </label>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: '#666', lineHeight: 1.4 }}>
              {scene.visualPrompt}
            </p>
          </div>

          <Button variant="outline" onClick={() => setIsEditing(true)} style={{ width: '100%', marginTop: 'auto' }}>
            Edit Scene
          </Button>
        </>
      )}

      {/* Close flex container */}
      </div>

      {/* Image Modal */}
      {isImageModalOpen && imageUrl && (
        <div
          onClick={() => setIsImageModalOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={imageUrl}
            alt={`Scene ${scene.sceneNumber}`}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: 'var(--radius-md)',
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setIsImageModalOpen(false)}
            style={{
              position: 'absolute',
              top: '20px',
              right: '20px',
              background: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              fontSize: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </Card>
  );
}
