import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow server-side code to use certain packages without bundling
  serverExternalPackages: ['@remotion/cli', 'fluent-ffmpeg', 'simple-git'],
};

export default nextConfig;
