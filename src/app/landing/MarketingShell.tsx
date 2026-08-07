import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./marketing.module.css";

export type MarketingPage = "inicio" | "soluciones" | "modulos" | "precios" | "contacto" | "registro";

export const CONTACT_PHONE_DISPLAY = "+56 9 8231 5934";
export const CONTACT_PHONE_LINK = "tel:+56982315934";
export const CONTACT_WHATSAPP = "https://wa.me/56982315934";
export const CONTACT_EMAIL = "sebastian@mgpconsultoria.cl";

const solutionItems = [
  ["Supermercados", "Monitorea precios, promociones y surtido para competir categoría a categoría.", "▣"],
  ["Farmacias", "Controla precios, disponibilidad y promociones en el canal farma.", "✚"],
  ["Multitiendas", "Compara precios y promociones online y físicas en múltiples formatos.", "▤"],
  ["Brand Intelligence", "Entiende el posicionamiento de tu marca y sus competidores.", "◇"],
  ["Pricing Intelligence", "Convierte datos de precios en señales comerciales accionables.", "$"],
  ["Reportes Ejecutivos", "Dashboards y reportes listos para decisiones de negocio.", "↗"],
] as const;

const moduleItems = [
  ["Dashboards", "KPIs y tendencias en tiempo real.", "▦"],
  ["AI Price Map", "Mapas competitivos construidos con IA.", "⌖"],
  ["Brand Intelligence AI", "Análisis conversacional de marcas.", "◇"],
  ["Alertas", "Señales automáticas de cambios relevantes.", "!"],
  ["Reportes", "Salidas ejecutivas y programadas.", "▤"],
  ["Exportaciones", "CSV, Excel y flujos de datos.", "↓"],
  ["Scraping Automatizado", "Captura continua de precios y surtido.", "⌁"],
] as const;

function NavDropdown({
  label,
  href,
  active,
  items,
}: {
  label: string;
  href: string;
  active: boolean;
  items: readonly (readonly [string, string, string])[];
}) {
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
          <Link href="/landing/precios" className={active === "precios" ? styles.navActive : undefined}>Precios</Link>
          <Link href="/landing/contacto" className={active === "contacto" ? styles.navActive : undefined}>Contacto</Link>
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginLeft: 4, whiteSpace: "nowrap" }}>
          <Link href="/login" style={{ color: "#d8e4f3", fontSize: 12, fontWeight: 800, padding: "10px 8px" }}>Ingresar</Link>
          <Link href="/registro" style={{ color: "#fff", background: "#1478ee", borderRadius: 10, fontSize: 12, fontWeight: 900, padding: "12px 15px", boxShadow: "0 10px 26px rgba(20,120,238,.22)" }}>Crear cuenta</Link>
          <Link className={styles.headerCta} href="/landing/contacto#demo">Solicitar demo</Link>
        </div>
      </div>
    </header>
  );
}

export function DashboardPreview({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`${styles.dashboard} ${compact ? styles.dashboardCompact : ""}`} aria-label="Vista demostrativa de MGP Super Precios">
      <aside className={styles.dashboardSide}>
        <strong>MGP</strong><small>Super Precios</small>
        {["Resumen", "Precios", "Promociones", "Surtido", "AI Price Map", "Alertas", "Dashboards", "Exportaciones"].map((item, index) => (
          <span key={item} className={index === 0 ? styles.sideActive : undefined}>{index === 0 ? "⌂" : "·"} {item}</span>
        ))}
      </aside>
      <div className={styles.dashboardBody}>
        <div className={styles.dashboardTop}><strong>Resumen general</strong><small>Vista demostrativa · Últimos 7 días</small></div>
        <div className={styles.miniMetrics}>
          <div><span>Productos</span><strong>380K+</strong><small>catálogo monitoreado</small></div>
          <div><span>Categorías</span><strong>100+</strong><small>consumo y retail</small></div>
          <div><span>Promociones</span><strong>18,6%</strong><small>del universo visible</small></div>
          <div><span>Disponibilidad</span><strong>98%</strong><small>señal operativa</small></div>
        </div>
        <div className={styles.dashboardGrid}>
          <div className={styles.chartPanel}>
            <div className={styles.panelTitle}><strong>Evolución de precio</strong><span>Índice 100</span></div>
            <svg viewBox="0 0 420 170" role="img" aria-label="Gráfico de evolución de precio">
              <path d="M10 145 H410 M10 100 H410 M10 55 H410" className={styles.gridLine} />
              <polyline points="15,130 62,92 108,108 155,72 201,90 248,58 295,78 342,44 405,28" className={styles.blueLine} />
              <polyline points="15,138 62,126 108,118 155,121 201,102 248,98 295,86 342,74 405,62" className={styles.greenLine} />
            </svg>
            <div className={styles.chartLegend}><span><i className={styles.blueDot} /> Tu mercado</span><span><i className={styles.greenDot} /> Competencia</span></div>
          </div>
          <div className={styles.donutPanel}>
            <div className={styles.panelTitle}><strong>Mix monitoreado</strong><span>Canal</span></div>
            <div className={styles.donut} />
            <div className={styles.donutLegend}><span><i className={styles.blueDot} />Supermercados</span><span><i className={styles.greenDot} />Farmacias</span><span><i className={styles.purpleDot} />Multitiendas</span></div>
          </div>
        </div>
        {!compact && <div className={styles.alertRow}>
          <div><i className={styles.alertRed} /><span>Alza atípica detectada</span><b>+12,8%</b></div>
          <div><i className={styles.alertOrange} /><span>Nueva promoción competitiva</span><b>-15,2%</b></div>
          <div><i className={styles.alertGreen} /><span>Disponibilidad recuperada</span><b>98,4%</b></div>
        </div>}
      </div>
    </div>
  );
}

export function AIPriceMapPreview() {
  const points = [
    [18, 68, "#2563eb", 18], [29, 38, "#22c55e", 12], [38, 58, "#f59e0b", 16], [48, 30, "#7c3aed", 11],
    [56, 72, "#0ea5e9", 22], [64, 48, "#22c55e", 14], [73, 62, "#f59e0b", 19], [82, 36, "#2563eb", 13],
  ];
  return (
    <div className={styles.aiPreview}>
      <div className={styles.aiChat}>
        <div className={styles.aiTitle}>Asistente IA <span>BETA</span></div>
        <div className={styles.chatUser}>¿Cómo está posicionada Coca-Cola en formato lata?</div>
        <div className={styles.chatAi}>Analicé los productos equivalentes y normalicé packs. Coca-Cola está por encima del índice medio de precio, con cobertura alta.</div>
        <div className={styles.chatAi}><strong>Insight:</strong> Pepsi es el competidor más cercano en precio equivalente.</div>
        <div className={styles.chatInput}>Escribe tu pregunta… <b>↗</b></div>
      </div>
      <div className={styles.priceMap}>
        <div className={styles.mapTop}><strong>AI Price Map · Formato lata</strong><span>Chile · Todas las cadenas</span></div>
        <div className={styles.mapChart}>
          <span className={styles.axisY}>Cobertura</span><span className={styles.axisX}>Índice de precio →</span>
          <i className={styles.parityLine} />
          {points.map(([x, y, color, size], index) => (
            <b key={index} className={styles.bubble} style={{ left: `${x}%`, bottom: `${y}%`, background: String(color), width: Number(size) * 2, height: Number(size) * 2 }}>
              {index === 5 ? "C" : ""}
            </b>
          ))}
        </div>
        <div className={styles.mapLegend}><span><i className={styles.greenDot} />Marca objetivo</span><span><i className={styles.blueDot} />Competidor</span><span><i className={styles.orangeDot} />Presión de precio</span></div>
      </div>
    </div>
  );
}

export function BrandPreview() {
  const rows = [
    ["Tu marca", "$2.890", "+5,3%", "18,6%", "96,8%", "142"],
    ["Competidor A", "$2.750", "+2,1%", "22,4%", "95,1%", "168"],
    ["Competidor B", "$3.120", "+8,7%", "15,3%", "97,2%", "121"],
    ["Competidor C", "$2.690", "-1,2%", "11,2%", "94,4%", "98"],
  ];
  return (
    <div className={styles.brandPreview}>
      <div className={styles.brandKpis}>
        <div><span>Precio promedio</span><strong>$2.890</strong><small>+0,3% vs período anterior</small></div>
        <div><span>Share de promociones</span><strong>18,6%</strong><small>+2,1 pp</small></div>
        <div><span>Disponibilidad</span><strong>96,8%</strong><small>+1,4 pp</small></div>
        <div><span>Promociones activas</span><strong>142</strong><small>+18</small></div>
      </div>
      <div className={styles.brandTable}>
        <div className={styles.brandTableHead}><span>Marca</span><span>Precio prom.</span><span>Var.</span><span>Share promos</span><span>Disponibilidad</span><span>Promos</span></div>
        {rows.map((row) => <div key={row[0]}>{row.map((cell, index) => <span key={index}>{cell}</span>)}</div>)}
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

export function BottomCTA({ title = "Convierte datos de precios en decisiones más rápidas", copy = "Agenda una demo personalizada y descubre el poder de MGP Super Precios." }: { title?: string; copy?: string }) {
  return <section className={styles.bottomCta}><div className={styles.rocket}>↗</div><div><h2>{title}</h2><p>{copy}</p></div><Link href="/landing/contacto#demo">Solicitar demo hoy</Link></section>;
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerGrid}>
        <div className={styles.footerBrand}>
          <Link href="/landing" className={styles.logo}><span className={styles.logoMark}>M</span><strong>MGP <em>Super Precios</em></strong></Link>
          <p>Price Intelligence para supermercados, farmacias, multitiendas y marcas en Chile y LatAm.</p>
          <a href={CONTACT_PHONE_LINK}>☎ {CONTACT_PHONE_DISPLAY}</a>
          <a href={`mailto:${CONTACT_EMAIL}`}>✉ {CONTACT_EMAIL}</a>
        </div>
        <div><strong>Plataforma</strong><Link href="/landing/soluciones">Soluciones</Link><Link href="/landing/modulos">Módulos</Link><Link href="/landing/precios">Precios</Link><Link href="/registro">Crear cuenta</Link><Link href="/login">Ingresar</Link></div>
        <div><strong>Recursos</strong><Link href="/landing/modulos">AI Price Map</Link><Link href="/landing/modulos">Brand Intelligence AI</Link><Link href="/landing/modulos">Dashboards</Link><Link href="/landing/contacto">Preguntas frecuentes</Link></div>
        <div><strong>Empresa</strong><Link href="/landing/contacto">Contacto</Link><a href={CONTACT_WHATSAPP} target="_blank" rel="noreferrer">WhatsApp</a><a href={`mailto:${CONTACT_EMAIL}`}>Correo</a><Link href="/login">Acceso clientes</Link></div>
        <div><strong>Legal</strong><span>Privacidad y seguridad</span><span>Uso responsable de datos</span><span>Información pública de mercado</span><span>Acceso autenticado al producto</span></div>
      </div>
      <div className={styles.footerBottom}><span>© 2026 MGP Super Precios. Todos los derechos reservados.</span><span>Hecho con ♥ en Chile</span></div>
    </footer>
  );
}

export function PageChrome({ active, children }: { active: MarketingPage; children: ReactNode }) {
  return <div className={styles.site}><SiteHeader active={active} />{children}<SiteFooter /></div>;
}
