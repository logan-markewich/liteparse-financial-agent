import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@llamaindex/liteparse",
    "sharp",
    "@hyzyla/pdfium",
    "tesseract.js",
    "puppeteer",
  ],
  eslint: {
    dirs: ["app", "lib"],
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // @llamaindex/liteparse is ESM-only, so we need to use import() not require()
      config.externals = config.externals || [];
      config.externals.push({
        "@llamaindex/liteparse": "module @llamaindex/liteparse",
        sharp: "commonjs sharp",
        "@hyzyla/pdfium": "commonjs @hyzyla/pdfium",
        puppeteer: "commonjs puppeteer",
      });
    }
    return config;
  },
};

export default nextConfig;
