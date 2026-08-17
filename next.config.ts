import type { NextConfig } from "next";

const MGP_SUPER_PRECIOS = "https://www.mgpconsultoria.cl/super-precios";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "jumbo.vteximg.com.br" },
      { protocol: "https", hostname: "santaisabel.vteximg.com.br" },
      { protocol: "https", hostname: "i5.walmartimages.cl" },
    ],
  },
  async redirects() {
    return [
      { source: "/landing", destination: MGP_SUPER_PRECIOS, permanent: true },
      { source: "/landing/soluciones", destination: MGP_SUPER_PRECIOS, permanent: true },
      { source: "/landing/modulos", destination: MGP_SUPER_PRECIOS, permanent: true },
      { source: "/landing/cobertura", destination: MGP_SUPER_PRECIOS, permanent: true },
      { source: "/landing/precios", destination: MGP_SUPER_PRECIOS, permanent: true },
      { source: "/landing/contacto", destination: MGP_SUPER_PRECIOS, permanent: true },
      { source: "/landing/demo", destination: MGP_SUPER_PRECIOS, permanent: true },
    ];
  },
};

export default nextConfig;
