import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [{
        source: "/",
        has: [{ type: "host", value: "homeoffernetwork\\.com" }],
        destination: "/sell",
      }],
      afterFiles: [],
      fallback: [],
    };
  },
};
export default nextConfig;
