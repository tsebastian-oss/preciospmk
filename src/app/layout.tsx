import "./globals.css";

export const metadata = {
  title: "MGP Super Precios",
  description: "Monitor de precios de supermercados en Chile"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
