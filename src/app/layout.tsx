import type { Viewport } from "next";
import "./globals.css";
import "./mobile-tablet-overrides.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata = {
  title: "MGP Intelligence | Inteligencia de Precios",
  description: "Plataforma enterprise de inteligencia de precios, promociones, disponibilidad, surtido y ejecución digital para retailers y marcas.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es-CL"><body>{children}</body></html>;
}
