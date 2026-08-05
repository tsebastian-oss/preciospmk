import "./globals.css";

export const metadata = {
  title: "MGP Retail Intelligence | Pricing, Assortment & Market Data",
  description: "Plataforma de inteligencia retail para monitorear precios, promociones, surtido, disponibilidad y catálogo de supermercados en Chile.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es-CL"><body>{children}</body></html>;
}
