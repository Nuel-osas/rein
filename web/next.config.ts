import type {NextConfig} from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Next 16 writes an AGENTS.md for coding agents on every dev start; the repo does not need it.
  agentRules: false,
  // The agent and 0G packages ship TypeScript source; Next compiles them with the app.
  transpilePackages: ["@rein/agent", "@rein/zg-compute"],
  // The 0G SDK and ethers load at runtime from node_modules (the SDK through its CommonJS build).
  serverExternalPackages: ["@0gfoundation/0g-compute-ts-sdk", "ethers"],
  // Pages folded into others. Redirects here answer before any page renders, so the status is a
  // real 307 rather than a client-side hop after the own-team gate has streamed.
  async redirects() {
    return [
      // The agents list is part of Team, which shows people and agents together.
      {source: "/agents", destination: "/spenders", permanent: false},
      {source: "/app/:team/agents", destination: "/app/:team/spenders", permanent: false},
      // The assistant is part of Compute, under the agent's run panel.
      {source: "/assistant", destination: "/compute", permanent: false},
      {source: "/app/:team/assistant", destination: "/app/:team/compute", permanent: false},
    ];
  },
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
