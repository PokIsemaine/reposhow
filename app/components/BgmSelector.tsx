'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, Button } from './ui';

export interface MusicTrack {
  music_id: string;
  title: string;
  author: string;
  duration_seconds: number;
  url?: string;
}

interface BgmSelectorProps {
  onSelect: (musicId: string | null) => void;
  selectedMusicId?: string | null;
}

export function BgmSelector({ onSelect, selectedMusicId }: BgmSelectorProps) {
  const [music, setMusic] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(selectedMusicId || null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const fetchMusic = async () => {
      try {
        const response = await fetch('/api/music');
        const data = await response.json();
        setMusic(data.music || []);
      } catch (error) {
        console.error('Failed to fetch music library:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchMusic();
  }, []);

  const handlePlay = (track: MusicTrack) => {
    if (playingId === track.music_id) {
      // Stop playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setPlayingId(null);
    } else {
      // Start playing
      if (audioRef.current) {
        audioRef.current.pause();
      }
      // In real implementation, would use track.url when available
      // For now, we'll just simulate playing
      setPlayingId(track.music_id);
      // Simulate playback duration
      setTimeout(() => {
        setPlayingId(null);
      }, Math.min(track.duration_seconds * 1000, 10000));
    }
  };

  const handleSelect = (musicId: string) => {
    const newSelectedId = selectedId === musicId ? null : musicId;
    setSelectedId(newSelectedId);
    onSelect(newSelectedId);
  };

  if (loading) {
    return (
      <Card style={{ padding: 'var(--space-md)' }}>
        <p style={{ color: '#666', textAlign: 'center' }}>Loading music library...</p>
      </Card>
    );
  }

  return (
    <Card style={{ padding: 'var(--space-md)' }}>
      <h3 style={{ margin: '0 0 var(--space-md)', fontSize: 'var(--text-lg)' }}>
        Background Music
      </h3>
      <p style={{ margin: '0 0 var(--space-md)', color: '#666', fontSize: 'var(--text-sm)' }}>
        Select background music for your video (optional)
      </p>

      {music.length === 0 ? (
        <p style={{ color: '#999', textAlign: 'center' }}>
          No background music available. A default track will be used.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {music.map((track) => (
            <div
              key={track.music_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-sm) var(--space-md)',
                background: selectedId === track.music_id ? 'rgba(0,0,0,0.05)' : '#f9f9f9',
                borderRadius: 'var(--radius-sm)',
                border: selectedId === track.music_id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onClick={() => handleSelect(track.music_id)}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 'var(--text-sm)' }}>{track.title}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: '#666' }}>
                  {track.author} • {Math.floor(track.duration_seconds / 60)}:{String(track.duration_seconds % 60).padStart(2, '0')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlay(track);
                  }}
                  style={{ minHeight: 'auto', padding: '4px 8px' }}
                >
                  {playingId === track.music_id ? '⏸' : '🔊'}
                </Button>
                {selectedId === track.music_id && (
                  <span style={{ color: 'var(--color-primary)', fontSize: 'var(--text-lg)' }}>✓</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedId && (
        <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-sm)', background: '#f0fff4', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-success)' }}>
            Selected: {music.find(m => m.music_id === selectedId)?.title}
          </p>
        </div>
      )}
    </Card>
  );
}
