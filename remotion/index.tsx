import { registerRoot, Composition } from 'remotion';
import { RepoShowComposition } from './Video';

export const Root = () => {
  return (
    <Composition
      id="reposhow"
      component={RepoShowComposition}
      durationInFrames={1800} // 60s * 30fps
      fps={30}
      width={1920}
      height={1080}
    />
  );
};

registerRoot(Root);
