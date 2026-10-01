import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.GITSCOPE_DIST_DIR || ".next",
  // Native WASM loaders must resolve their files outside the server bundle.
  serverExternalPackages: ["web-tree-sitter", "@vscode/tree-sitter-wasm"],
  // Explicit opt-in for trusted development devices; empty on a fresh checkout.
  allowedDevOrigins: (process.env.GITSCOPE_DEV_ORIGINS || "")
    .split(",").map((origin) => origin.trim()).filter(Boolean),
};

export default nextConfig;
