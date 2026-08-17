import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./marketing.module.css";
import MarketingMobileNav from "./MarketingMobileNav";

export type MarketingPage = "inicio" | "soluciones" | "modulos" | "precios" | "contacto" | "registro" | "cobertura";

export const CONTACT_PHONE_DISPLAY = "+56 9 8231 5934";
export const CONTACT_PHONE_LINK = "tel:+56982315934";
export const CONTACT_WHATSAPP = "https://wa.me/56982315934";
export const CONTACT_EMAIL = "commercial@mgpconsultoria.cl";

const solutionItems = [
  ["Análisis de precios", "Evolución, brechas y movimientos de precio sobre los datos disponibles.", "⌁"],
  ["Análisis de categorías", "Composición, marcas, retailers y evolución por categoría.", "◒"],
  ["Productos", "Consulta precios actuales por marca, producto y retailer.", "□"],
  ["Brands", "Competencia, precios, productos, retailers y listings de una marca.", "◆"],
  ["Automotriz", "Modelos, versiones, bonos, precio final y variaciones semanales.", "◇"],
  ["Datos y operación", "Descarga CSV para Excel y estado de actualización de las fuentes.", "↓"],
] as const;

const moduleItems = [
  ["Asistente & Inicio", "Lectura ejecutiva y consultas con IA sobre los datos disponibles.", "✦"],
  ["Evolución de precios", "Histórico por marca, producto y retailer.", "⌁"],
  ["Brechas de precio", "Diferencias entre retailers sobre universos comparables.", "⇄"],
  ["Movimientos y alertas", "Alzas y bajas detectadas en el mercado monitoreado.", "!"],
  ["Análisis de categorías", "Mix, marcas y composición del catálogo por retailer.", "◒"],
  ["Productos", "Precios actuales con filtros de marca y producto.", "□"],
  ["Brands", "Vertical dedicada para seguimiento de marcas.", "◆"],
  ["Mercado automotriz", "Catálogo y estructura de precios desde concesionarios.", "◇"],
  ["Descarga de bases", "CSV preparado para trabajar en Excel.", "↓"],
  ["Estado de datos", "Freshness y actividad de las fuentes monitoreadas.", "↻"],
] as const;

function NavDropdown({ label, href, active, items }: { label: string; href: string; active: boolean; items: readonly (readonly [string, string, string])[] }) {
  return (
    <div className={styles.navDropdown}>
      <Link href={href} className={active ? styles.navActive : undefined}>{label}</Link>
      <div className={styles.megaMenu}>
        {items.map(([title, copy, icon]) => (
          <Link href={href} key={title} className={styles.megaItem}>
            <span>{icon}</span>
            <div><strong>{title}</strong><small>{copy}</small></div>
            <b>›</b>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function SiteHeader({ active }: { active: MarketingPage }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href="/landing" className={styles.logo} aria-label="MGP Super Precios">
          <span className={styles.logoMark}>M</span>
          <strong>MGP <em>Super Precios</em></strong>
        </Link>
        <nav className={styles.nav} aria-label="Navegación principal">
          <Link href="/landing" className={active === "inicio" ? styles.navActive : undefined}>Inicio</Link>
          <NavDropdown label="Soluciones" href="/landing/soluciones" active={active === "soluciones"} items={solutionItems} />
          <NavDropdown label="Módulos" href="/landing/modulos" active={active === "modulos"} items={moduleItems} />
          <Link href="/landing/cobertura" className={active === "cobertura" ? styles.navActive : undefined}>Cobertura</Link>
          <Link href="/landing/precios" className={active === "precios" ? styles.navActive : undefined}>Precios</Link>
          <Link href="/landing/contacto" className={active === "contacto" ? styles.navActive : undefined}>Contacto</Link>
        </nav>
        <div className={styles.desktopHeaderActions}>
          <Link href="/login" style={{ color: "#d8e4f3", fontSize: 12, fontWeight: 800, padding: "10px 8px" }}>Ingresar</Link>
          <Link href="/registro" style={{ color: "#fff", background: "#1478ee", borderRadius: 10, fontSize: 12, fontWeight: 900, padding: "12px 15px", boxShadow: "0 10px 26px rgba(20,120,238,.22)" }}>Crear cuenta</Link>
          <Link className={styles.headerCta} href="/landing/contacto#demo">Solicitar demo</Link>
        </div>
        <MarketingMobileNav />
      </div>
    </header>
  );
}

export function DashboardPreview({ compact = false }: { compact?: boolean }) {
  const nav = ["Asistente & Inicio", "Evolución de precios", "Brechas de precio", "Movimientos y alertas", "Análisis de categorías", "Productos", "Brands", "Automotriz", "Descarga de bases", "Estado de datos"];
  return (
    <div className={`${styles.dashboard} ${compact ? styles.dashboardCompact : ""}`} aria-label="Vista demostrativa de MGP Super Precios">
      <aside className={styles.dashboardSide}>
        <strong>MGP</strong><small>Super Precios</small>
        {nav.slice(0, compact ? 6 : 8).map((item, index) => (
          <span key={item} className={index === 0 ? styles.sideActive : undefined}>{index === 0 ? "✦" : "·"} {item}</span>
        ))}
      </aside>
      <div className={styles.dashboardBody}>
        <div className={styles.dashboardTop}><strong>Asistente & Inicio</strong><small>Vista demostrativa · datos ilustrativos</small></div>
        <div className={styles.miniMetrics}>
          <div><span>Histórico</span><strong>Activo</strong><small>evolución de precios</small></div>
          <div><span>Categorías</span><strong>Análisis</strong><small>mix y composición</small></div>
          <div><span>Brands</span><strong>Vertical</strong><small>seguimiento de marcas</small></div>
          <div><span>Automotriz</span><strong>Dealer-first</strong><small>precios y variaciones</small></div>
        </div>
        <div className={styles.dashboardGrid}>
          <div className={styles.chartPanel}>
            <div className={styles.panelTitle}><strong>Evolución de precios</strong><span>Histórico</span></div>
            <svg viewBox="0 0 420 170" role="img" aria-label="Gráfico demostrativo de evolución de precios">
              <path d="M10 145 H410 M10 100 H410 M10 55 H410" className={styles.gridLine} />
              <polyline points="15,128 62,118 108,121 155,96 201,102 248,79 295,84 342,60 405,52" className={styles.blueLine} />
              <polyline points="15,138 62,132 108,126 155,119 201,110 248,107 295,96 342,89 405,78" className={styles.greenLine} />
            </svg>
            <div className={styles.chartLegend}><span><i className={styles.blueDot} /> Precio observado</span><span><i className={styles.greenDot} /> Período comparable</span></div>
          </div>
          <div className={styles.donutPanel}>
            <div className={styles.panelTitle}><strong>Análisis de categorías</strong><span>Mix</span></div>
            <div className={styles.donut} />
            <div className={styles.donutLegend}><span><i className={styles.blueDot} />Marcas</span><span><i className={styles.greenDot} />Productos</span><span><i className={styles.purpleDot} />Retailers</span></div>
          </div>
        </div>
        {!compact && <div className={styles.alertRow}>
          <div><i className={styles.alertRed} /><span>Movimiento de precio</span><b>Detectado</b></div>
          <div><i className={styles.alertOrange} /><span>Brecha entre retailers</span><b>Comparada</b></div>
          <div><i className={styles.alertGreen} /><span>Estado de fuente</span><b>Actualizado</b></div>
        </div>}
      </div>
    </div>
  );
}

export function SectionHeading({ eyebrow, title, copy }: { eyebrow?: string; title: string; copy?: string }) {
  return <div className={styles.sectionHeading}>{eyebrow && <span>{eyebrow}</span>}<h2>{title}</h2>{copy && <p>{copy}</p>}</div>;
}

export function PillIcon({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "green" | "purple" | "orange" }) {
  return <span className={`${styles.pillIcon} ${styles[`tone_${tone}`]}`}>{children}</span>;
}

export function BottomCTA({ title = "Convierte datos de precios en decisiones más rápidas", copy = "Coordina una demo personalizada y descubre MGP Super Precios." }: { title?: string; copy?: string }) {
  return <section className={styles.bottomCta}><div className={styles.rocket}>↗</div><div><h2>{title}</h2><p>{copy}</p></div><Link href="/landing/contacto#demo">Solicitar demo</Link></section>;
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerGrid}>
        <div className={styles.footerBrand}>
          <Link href="/landing" className={styles.logo}><span className={styles.logoMark}>M</span><strong>MGP <em>Super Precios</em></strong></Link>
          <p>Inteligencia de precios y mercado para retail, marcas y automotriz.</p>
          <a href={CONTACT_PHONE_LINK}>☎ {CONTACT_PHONE_DISPLAY}</a>
          <a href={`mailto:${CONTACT_EMAIL}`}>✉ {CONTACT_EMAIL}</a>
        </div>
        <div><strong>Plataforma</strong><Link href="/landing/soluciones">Soluciones</Link><Link href="/landing/modulos">Módulos</Link><Link href="/landing/cobertura">Cobertura</Link><Link href="/landing/precios">Precios</Link><Link href="/registro">Crear cuenta</Link><Link href="/login">Ingresar</Link></div>
        <div><strong>Capacidades</strong><Link href="/landing/modulos">Evolución de precios</Link><Link href="/landing/modulos">Análisis de categorías</Link><Link href="/landing/modulos">Brands</Link><Link href="/landing/modulos">Automotriz</Link><Link href="/landing/cobertura">Retailers monitoreados</Link></div>
        <div><strong>Empresa</strong><Link href="/landing/contacto">Contacto</Link><a href={CONTACT_WHATSAPP} target="_blank" rel="noreferrer">WhatsApp</a><a href={`mailto:${CONTACT_EMAIL}`}>Correo</a><Link href="/login">Acceso clientes</Link></div>
        <div><strong>Legal</strong><Link href="/landing/legal/privacidad">Privacidad y seguridad</Link><Link href="/landing/legal/terminos">Términos de uso</Link><Link href="/landing/legal/uso-datos">Uso responsable de datos</Link><Link href="/landing/legal/informacion-publica">Información pública de mercado</Link><Link href="/landing/legal/acceso-producto">Acceso autenticado al producto</Link></div>
      </div>
      <div className={styles.footerBottom}><span>© 2026 MGP Super Precios. Todos los derechos reservados.</span><span>Hecho con ♥ en Chile</span></div>
    </footer>
  );
}

export function PageChrome({ active, children }: { active: MarketingPage; children: ReactNode }) {
  return <div className={styles.site}><SiteHeader active={active} />{children}<SiteFooter /></div>;
}
