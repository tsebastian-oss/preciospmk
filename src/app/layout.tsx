import "./globals.css";

export const metadata = {
  title: "MGP Price Intelligence",
  description: "Dashboard de precios y promociones de supermercados en Chile",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es-CL"><body>{children}</body></html>;
}
