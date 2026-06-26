import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack config (dev server)
  turbopack: {},

  webpack: (config, { isServer }) => {
    if (!isServer) {
      // pdfjs-dist relies on canvas in Node but we're in browser — mark it as empty
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: false,
      };
    }
    return config;
  },
};

export default nextConfig;
