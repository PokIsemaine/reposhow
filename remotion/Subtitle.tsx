import { AbsoluteFill, useCurrentFrame, interpolate, useVideoConfig } from 'remotion';

interface SubtitleProps {
  text: string;
  startFrame: number;
  durationFrames: number;
}

export function Subtitle({ text, startFrame, durationFrames }: SubtitleProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentFrame = frame - startFrame;

  // Don't render if outside the duration
  if (currentFrame < 0 || currentFrame > durationFrames) {
    return null;
  }

  // Fade in/out animation
  const fadeFrames = 15; // ~0.5 seconds at 30fps
  let opacity = 1;

  if (currentFrame < fadeFrames) {
    opacity = interpolate(currentFrame, [0, fadeFrames], [0, 1]);
  } else if (currentFrame > durationFrames - fadeFrames) {
    opacity = interpolate(currentFrame, [durationFrames - fadeFrames, durationFrames], [1, 0]);
  }

  // Word-level highlighting logic
  // Split text into words
  const words = text.split(/\s+/);
  const totalWords = words.length;

  // Estimate words per second (average ~3 words per second for TTS)
  const wordsPerSecond = 3;
  const wordsPerFrame = (wordsPerSecond * fps) / fps; // words per frame
  const secondsElapsed = currentFrame / fps;
  const wordsRead = Math.floor(secondsElapsed * wordsPerSecond);
  const currentWordIndex = Math.min(Math.max(0, wordsRead), totalWords - 1);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: '5%',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          paddingLeft: 24,
          paddingRight: 24,
          paddingTop: 12,
          paddingBottom: 12,
          borderRadius: 8,
          maxWidth: '80%',
        }}
      >
        <p
          style={{
            color: '#ffffff',
            fontSize: 24,
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
            textAlign: 'center',
            margin: 0,
            lineHeight: 1.4,
            opacity,
          }}
        >
          {words.map((word, index) => (
            <span
              key={index}
              style={{
                color: index <= currentWordIndex ? '#FFD700' : '#FFFFFF',
                transition: 'color 0.1s ease',
                fontWeight: index === currentWordIndex ? 'bold' : 'normal',
              }}
            >
              {word}{' '}
            </span>
          ))}
        </p>
      </div>
    </AbsoluteFill>
  );
}
