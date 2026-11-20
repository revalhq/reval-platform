import type { NextConfig } from "next";

// Where the Fastify API lives. Read at build time (rewrites are baked into the build),
// so set API_URL for `next build` as well as `next dev`.
// On Vercel the localhost fallback can never work (requests fail with DNS_HOSTNAME_RESOLVED_PRIVATE),
// so fail the build instead of deploying a portal that can't reach the API.
if (process.env.VERCEL && !process.env.API_URL) {
  throw new Error("API_URL must be set for this Vercel environment (the API's public URL, e.g. https://<api>.vercel.app)");
}
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
