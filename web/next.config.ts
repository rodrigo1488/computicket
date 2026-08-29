import type { NextConfig } from "next";
import path from "path";

const flaskOrigin = process.env.FLASK_URL || "http://127.0.0.1:5000";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  allowedDevOrigins: ["192.168.2.122", "localhost", "127.0.0.1"],
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/orcamentos/publico/:token", destination: `${flaskOrigin}/orcamentos/publico/:token` },
        { source: "/orcamentos/publico/:token/:path*", destination: `${flaskOrigin}/orcamentos/publico/:token/:path*` },
        { source: "/orcamentos/logo", destination: `${flaskOrigin}/orcamentos/logo` },
      ],
      afterFiles: [{ source: "/flask/:path*", destination: `${flaskOrigin}/:path*` }],
    };
  },
};

export default nextConfig;
