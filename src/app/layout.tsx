import "./globals.css";

export const metadata = {
  title: "MGP Intelligence | Inteligencia de Precios",
  description: "Plataforma enterprise de inteligencia de precios, promociones, disponibilidad, surtido y ejecución digital para retailers y marcas.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es-CL"><body>{children}</body></html>;
}
