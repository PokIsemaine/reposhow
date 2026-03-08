import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, staticFile } from 'remotion';
import { useMemo } from 'react';

export interface SceneData {
  sceneNumber: number;
  durationSec: number;
  narrationText: string;
  visualPrompt: string;
  transition: string;
}

interface SceneProps {
  scene: SceneData;
  imagePath: string;
  defaultImage: string;
}

export function Scene({ scene, imagePath, defaultImage }: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Use staticFile() to resolve paths from public folder
  const resolvedImagePath = imagePath ? staticFile(imagePath) : defaultImage;

  // Calculate transition progress (first 1 second = 30 frames at 30fps)
  const transitionDuration = fps;
  const transitionProgress = Math.min(frame / transitionDuration, 1);

  // Animate opacity based on transition
  const opacity = useMemo(() => {
    if (scene.transition === 'fade') {
      return transitionProgress < 0.3
        ? interpolate(transitionProgress, [0, 0.3], [0, 1])
        : 1;
    }
    return 1;
  }, [transitionProgress, scene.transition]);

  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundColor: '#0a0a0a',
      }}
    >
      {/* Background Image */}
      <img
        src={resolvedImagePath}
        alt={`Scene ${scene.sceneNumber}`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />

      {/* Scene number indicator */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          color: 'rgba(255,255,255,0.5)',
          fontSize: 18,
          fontFamily: 'Inter, sans-serif',
        }}
      >
        {scene.sceneNumber}
      </div>
    </AbsoluteFill>
  );
}
