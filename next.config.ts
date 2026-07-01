import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Avoid DevTools draggable pointer-capture conflicts while testing gestures.
  devIndicators: false,
};

export default nextConfig;
