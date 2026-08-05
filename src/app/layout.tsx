import "./globals.css";
import EnterpriseAdminQuickLinks from "./EnterpriseAdminQuickLinks";
import EnterpriseAlertCenter from "./EnterpriseAlertCenter";
import EnterpriseReportCenter from "./EnterpriseReportCenter";
import EnterpriseSidebarLink from "./EnterpriseSidebarLink";

export const metadata = {
  title: "MGP Intelligence | Retailer & Brand Intelligence",
  description: "Plataforma enterprise de inteligencia de precios, promociones, disponibilidad, surtido y ejecución digital para retailers y marcas.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es-CL"><body>{children}<EnterpriseSidebarLink /><EnterpriseAdminQuickLinks /><EnterpriseAlertCenter /><EnterpriseReportCenter /></body></html>;
}
