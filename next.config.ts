import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  // Media files live in storage/ and recursos/: never trace them into builds.
  outputFileTracingExcludes: {
    '*': ['storage/**', 'recursos/**', 'models/**'],
  },
};

export default nextConfig;
