'use client';

import { useState, useRef } from 'react';
import { MusicTrack } from './BgmSelector';

interface BgmVisualizerProps {
  track: MusicTrack | null;
  bgmOptions: MusicTrack[];
  onSelect: (musicId: string | null) => void;
}

/**
 * BGM Selector for storyboard page
 * Note: This component only allows selecting BGM style, no playback preview
 * because the actual BGM is generated after clicking "Generate Assets"
 */
export function BgmVisualizer({ track, bgmOptions, onSelect }: BgmVisualizerProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useState(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  });

  const handleSelect = (musicId: string) => {
    onSelect(musicId || null);
    setShowDropdown(false);
  };

  return (
    <div
      ref={dropdownRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-sm)',
        minWidth: '200px',
      }}
    >
      {/* Label */}
      <span style={{ fontSize: 'var(--text-xs)', color: '#666' }}>Background Music</span>

      {/* Music Selector - Show selected track or dropdown trigger */}
      {track ? (
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
          {/* Music Icon */}
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
              fontSize: '16px',
              flexShrink: 0,
            }}
          >
            🎵
          </div>

          {/* Track Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {track.title}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: '#666' }}>
              {track.author}
            </div>
          </div>

          {/* Change Button */}
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            style={{
              padding: '4px 8px',
              border: '1px solid var(--color-border)',
              background: 'white',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              fontSize: 'var(--text-xs)',
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-sm)',
            padding: 'var(--space-sm) var(--space-md)',
            background: 'white',
            border: '2px dashed var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            color: '#666',
          }}
        >
          <span>🎵</span>
          <span>Select Background Music</span>
        </button>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div
          style={{
            background: 'white',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxHeight: '200px',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              padding: 'var(--space-xs) var(--space-sm)',
              fontSize: 'var(--text-xs)',
              color: '#666',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            Select BGM (applied after generation)
          </div>
          <div
            style={{
              padding: 'var(--space-xs) var(--space-sm)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              color: '#666',
            }}
            onClick={() => handleSelect('')}
          >
            None
          </div>
          {bgmOptions.map((option) => (
            <div
              key={option.music_id}
              style={{
                padding: 'var(--space-xs) var(--space-sm)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                background: track?.music_id === option.music_id ? 'rgba(0,0,0,0.05)' : 'transparent',
                fontWeight: track?.music_id === option.music_id ? 500 : 400,
              }}
              onClick={() => handleSelect(option.music_id)}
            >
              {option.title} - {option.author}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
