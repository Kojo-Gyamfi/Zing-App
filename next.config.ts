import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ngrok tunnel for testing on a real phone -- dev server only, ignored in production.
  allowedDevOrigins: ['untreacherous-leontine-nonpejoratively.ngrok-free.dev'],
};

export default nextConfig;
