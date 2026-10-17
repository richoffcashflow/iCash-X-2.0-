import type { NextConfig } from "next";
import {securityHeaders,webinarSecurityHeaders} from './lib/security-headers';
const nextConfig: NextConfig = {
  async headers(){return [{source:'/:path*',headers:securityHeaders},...['/live/:webinarCode','/webinar','/webinar/checkout','/webinar/upgrade'].map(source=>({source,headers:webinarSecurityHeaders})),...['/invite/:path*','/private-access'].map(source=>({source,headers:[{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Robots-Tag',value:'noindex, nofollow, noarchive'},{key:'Cache-Control',value:'private, no-store'}]})),{source:'/next/:path*',headers:[{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Robots-Tag',value:'noindex, nofollow'},{key:'Cache-Control',value:'private, no-store'}]},{source:'/dashboard-unlock',headers:[{key:'Cache-Control',value:'private, no-store'},{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Robots-Tag',value:'noindex, nofollow'}]}];},
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
