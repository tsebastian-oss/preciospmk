import Link from "next/link";
import {
  AIPriceMapPreview,
  BottomCTA,
  BrandPreview,
  DashboardPreview,
  PageChrome,
  PillIcon,
  SectionHeading,
} from "../MarketingShell";
import styles from "../marketing.module.css";

export const metadata = {
  title: "Módulos | MGP Super Precios",
  description: "Dashboards, AI Price Map, Brand Intelligence AI, alertas, reportes, exportaciones y scraping automatizado.",
};

const modules = [
  ["Dashboards", "KPIs, tendencias, filtros y comparativos para leer el mercado en tiempo real.", "▦", "blue"],
  ["AI Price Map", "Preguntas en lenguaje natural que terminan en mapas competitivos construidos con datos reales.", "⌖", "purple"],
  ["Brand Intelligence AI", "Analiza marcas, competencia, precios, promociones, surtido y disponibilidad mediante IA.", "◇", "green"],
  ["Alertas", "Detecta variaciones de precio, promociones nuevas, gaps y cambios relevantes.", "!", "orange"],
  ["Reportes", "Salidas ejecutivas con los indicadores que necesita cada equipo.", "▤", "blue"],
  ["Exportaciones", "Lleva datos a Excel, CSV y flujos de análisis externos.", "↓", "green"],
  ["Scraping Automatizado", "Pipeline de captura y actualización de catálogos y precios.", "⌁", "blue"],
] as const;

export default function ModulesPage() {
  return (
    <PageChrome active="modulos">
      <main>
        <section className={styles.subHero}>
          <div className={styles.subHeroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>SUITE DE INTELIGENCIA COMERCIAL</span>
              <h1>Todos los módulos para inteligencia de precios <em>en tiempo real</em></h1>
              <p>Una suite conectada para monitorear mercado, interpretar cambios y transformar información competitiva en acciones para pricing, marketing, category management y ventas.</p>
              <div className={styles.heroActions}><Link href="/landing/contacto#demo" className={styles.primaryBtn}>Agenda una demo</Link><Link href="/login" className={styles.secondaryBtn}>▷ Ver plataforma</Link></div>
              <div className={styles.heroTrust}><span>Datos automatizados</span><span>IA conectada a la base</span><span>Exportaciones listas</span></div>
            </div>
            <div>
              <div className={styles.visibleMenu} style={{ marginBottom: 16 }}>
                {modules.slice(0, 6).map(([title, copy, icon]) => <Link href="#catalogo" key={title}><span>{icon}</span><div><strong>{title}</strong><small>{copy}</small></div><b>›</b></Link>)}
              </div>
              <DashboardPreview compact />
            </div>
          </div>
        </section>

        <section id="catalogo" className={styles.section}>
          <SectionHeading title="Conoce todos nuestros módulos" copy="Cada módulo resuelve una parte del problema; juntos construyen una vista completa del mercado." />
          <div className={styles.featureGrid}>
            {modules.map(([title, copy, icon, tone]) => <article className={styles.featureCard} key={title}><PillIcon tone={tone}>{icon}</PillIcon><h3>{title}</h3><p>{copy}</p><Link href="/landing/contacto#demo">Ver módulo →</Link></article>)}
          </div>
        </section>

        <section className={`${styles.highlight} ${styles.highlightPurple}`}>
          <div className={styles.highlightCopy}>
            <span>MÓDULO DESTACADO</span><h2>AI Price Map</h2>
            <p>El usuario describe la pregunta comercial y la IA detecta marca, formato, categoría y comparables para construir una lectura visual del posicionamiento de precios.</p>
            <ul className={styles.checkList}><li>Mapa de burbujas competitivo.</li><li>Normalización de packs y unidades.</li><li>Competidores seleccionados desde datos reales.</li><li>Explicación ejecutiva generada por IA.</li></ul>
            <Link className={styles.outlineCta} href="/landing/contacto#demo">Quiero ver AI Price Map</Link>
          </div>
          <AIPriceMapPreview />
        </section>

        <section className={styles.highlight}>
          <div className={styles.highlightCopy}>
            <span>MÓDULO DESTACADO</span><h2>Brand Intelligence AI</h2>
            <p>Pregunta “¿cómo está Nivea?” o “¿qué está pasando con Becker?” y recibe un diagnóstico construido sobre los datos disponibles para la marca.</p>
            <ul className={styles.checkList}><li>Precios y dispersión por retailer.</li><li>Promociones y disponibilidad.</li><li>Comparación competitiva contextual.</li><li>Historial de conversaciones por usuario.</li></ul>
            <Link className={styles.outlineCta} href="/landing/contacto#demo">Conocer Brand Intelligence</Link>
          </div>
          <BrandPreview />
        </section>

        <section className={styles.section}>
          <SectionHeading title="Integraciones y exportaciones" copy="Conecta la información con el flujo de trabajo que ya utiliza tu equipo." />
          <div className={styles.featureGrid}>
            {[["CSV","▤","blue"],["Excel","X","green"],["BigQuery","◈","blue"],["API","</>","purple"],["Power BI","▥","orange"],["Looker Studio","◎","blue"],["Slack","#","purple"]].map(([title,icon,tone]) => <article className={styles.featureCard} key={title}><PillIcon tone={tone as "blue"|"green"|"purple"|"orange"}>{icon}</PillIcon><h3>{title}</h3><p>Disponible según configuración e implementación del cliente.</p></article>)}
          </div>
          <div className={styles.securityNote}><b>◎</b><div><strong>¿Necesitas una integración personalizada?</strong><p>Podemos diseñar una salida o conector para tu flujo de trabajo. Cuéntanos qué sistema utilizas y qué datos necesitas.</p><Link href="/landing/contacto" className={styles.outlineCta}>Hablemos</Link></div></div>
        </section>

        <BottomCTA />
      </main>
    </PageChrome>
  );
}
