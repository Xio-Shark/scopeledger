import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Container deployment: .next/standalone carries the traced server.
  output: "standalone",
  // Set at build time when served under a path.
  basePath: process.env.SCOPELEDGER_BASE_PATH || undefined,
};

export default nextConfig;
