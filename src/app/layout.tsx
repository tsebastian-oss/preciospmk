import type { Viewport } from "next";
import "./globals.css";
import "./mobile-tablet-overrides.css";
import "./desktop-layout-overrides-v2.css";
import "./pharmacy-status-overrides.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata = {
  title: "MGP Super Precios | Retail & Price Intelligence",
  description: "Plataforma de inteligencia de precios, promociones, disponibilidad, surtido y análisis competitivo para retailers y marcas.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es-CL"><body>{children}</body></html>;
}
