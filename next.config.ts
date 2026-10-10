import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  async headers(){return [{source:'/next/:path*',headers:[{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Robots-Tag',value:'noindex, nofollow'},{key:'Cache-Control',value:'private, no-store'}]}];},
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
