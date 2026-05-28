import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@our-haven/shared', '@our-haven/openapi-types'],
};

export default config;
