import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server and only the modules
  // actually imported — the container image ships that instead of node_modules.
  output: "standalone",

  // Native and generated code that must not be bundled into the server build.
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@tus/server",
    "@tus/file-store",
    "@tus/s3-store",
    "nodemailer",
  ],
};

export default nextConfig;
