import { Composition, AbsoluteFill, Audio, useVideoConfig, Sequence, staticFile } from 'remotion';
import { Scene, SceneData } from './Scene';
import { Subtitle } from './Subtitle';

export interface StoryboardData {
  scenes: SceneData[];
  totalDurationSec: number;
}

export interface AssetsData {
  images: string[];
  voiceAudio?: string;
  voiceAudioFiles?: string[];
  bgmAudio?: string;
  bgmVolume?: number;
  mixedAudio: string;
}

export interface VideoProps extends Record<string, unknown> {
  storyboard: StoryboardData;
  assets: AssetsData;
  defaultImage?: string;
}

function VideoContent(props: VideoProps) {
  const { storyboard, assets, defaultImage = '' } = props;
  const { fps } = useVideoConfig();
  let currentFrame = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      {/* Background BGM (continuous across all scenes) */}
      {assets.bgmAudio && (
        <Audio src={staticFile(assets.bgmAudio)} volume={assets.bgmVolume ?? 0.3} />
      )}

      {/* Render each scene with its own voice audio */}
      {storyboard.scenes.map((scene, index) => {
        const sceneDurationFrames = scene.durationSec * fps;
        const sceneStartFrame = currentFrame;
        currentFrame += sceneDurationFrames;

        const imagePath = assets.images[index] || defaultImage;
        const sceneVoiceFile = assets.voiceAudioFiles?.[index];

        return (
          <Sequence
            key={`scene-${scene.sceneNumber}`}
            from={sceneStartFrame}
            durationInFrames={sceneDurationFrames}
          >
            {/* Scene-level voice audio - plays independently for each scene */}
            {sceneVoiceFile && (
              <Audio src={staticFile(sceneVoiceFile)} volume={1} />
            )}

            <Scene
              scene={scene}
              imagePath={imagePath}
              defaultImage={defaultImage}
            />
            <Subtitle
              text={scene.narrationText}
              startFrame={0}
              durationFrames={sceneDurationFrames}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

// Simple composition without complex type inference
export const RepoShowComposition = (props: VideoProps) => {
  return <VideoContent {...props} />;
};
