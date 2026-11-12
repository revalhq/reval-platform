import type { NextConfig } from "next";

// Where the Fastify API lives. Read at build time (rewrites are baked into the build),
// so set API_URL for `next build` as well as `next dev`.
const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Proxy the portal API through Next.js so the session cookie stays same-origin.
  // beforeFiles: always wins over the /[org] dynamic route.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/portal/:path*", destination: `${API_URL}/portal/:path*` }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
