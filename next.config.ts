import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The antd stylesheet's name carries a hash of its content
  // (scripts/antd-css.mjs), so a browser may keep it for good.
  async headers() {
    return [{
      source: '/antd/:file*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    }]
  },
};

export default nextConfig;
