import type {NextConfig} from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Next 16 writes an AGENTS.md for coding agents on every dev start; the repo does not need it.
  agentRules: false,
  // The agent package ships TypeScript source; Next compiles it with the app.
  transpilePackages: ["@rein/agent"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {key: "Content-Security-Policy", value: "frame-ancestors 'self'"},
          {key: "X-Frame-Options", value: "SAMEORIGIN"},
          {key: "X-Content-Type-Options", value: "nosniff"},
          {key: "Referrer-Policy", value: "strict-origin-when-cross-origin"},
        ],
      },
    ];
  },
};

export default config;
