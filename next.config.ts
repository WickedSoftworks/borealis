import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server and only the modules
  // actually imported — the container image ships that instead of node_modules.
  output: "standalone",

  // Nothing is gained by announcing the framework to every scanner.
  poweredByHeader: false,

  // Native and generated code that must not be bundled into the server build.
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@tus/server",
    "@tus/file-store",
    "@tus/s3-store",
    "nodemailer",
    "sharp",
  ],

  /**
   * Headers that are right for every response, pages and API alike. The ones
   * that depend on the deployment — CSP, HSTS — are set per request in
   * proxy.ts, since these are fixed at build time.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Share and collection URLs are credentials. `same-origin` keeps
          // the full URL for navigation inside the instance and sends nothing
          // at all to any other site a page links to.
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
