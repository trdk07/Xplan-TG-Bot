import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

void initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  typedRoutes: true,
  allowedDevOrigins: ["xplan.ai-flow.cc"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
