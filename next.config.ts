import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Import Sales sends the spreadsheet (base64) to the server for each step; the default 1 MB limit is too small.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
