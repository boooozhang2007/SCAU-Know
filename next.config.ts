import type { NextConfig } from "next";

const isStatic = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: [
    "unpdf",
    "mammoth",
    "xlsx",
    "sharp",
    "word-extractor",
    "jszip",
    "node-unrar-js",
  ],
  ...(isStatic
    ? {
        output: "export",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
