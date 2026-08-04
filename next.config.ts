import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "jumbo.vteximg.com.br" },
      { protocol: "https", hostname: "santaisabel.vteximg.com.br" },
      { protocol: "https", hostname: "i5.walmartimages.cl" },
    ],
  },
};

export default nextConfig;
