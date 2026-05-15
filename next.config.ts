import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      source: '/(books|api/qbo)(.*)',
      headers: [{ key: 'Cache-Control', value: 'no-store, no-cache' }],
    },
  ],
};

export default nextConfig;
