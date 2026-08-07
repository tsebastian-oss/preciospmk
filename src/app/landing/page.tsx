import Link from "next/link";
import {
  AIPriceMapPreview,
  BottomCTA,
  DashboardPreview,
  PageChrome,
  PillIcon,
  SectionHeading,
} from "./MarketingShell";
import styles from "./marketing.module.css";

export const metadata = {
  title: "MGP Super Precios | Price Intelligence para Chile y LatAm",
  description: "Monitorea precios, promociones, surtido y competencia con dashboards, alertas e inteligencia artificial.",
};

const modules = [
  ["Scraping automatizado", "Capturamos precios, promociones y surtido de miles de productos de forma continua.", "⌁", "blue"],
  ["Dashboards dinámicos", "Visualiza KPIs, tendencias y comparativas en tiempo real con filtros avanzados.", "▦", "blue"],
  ["Brand Intelligence", "Monitorea tu marca, la competencia, promociones, disponibilidad y posicionamiento.", "◇", "purple"],
  ["AI Price Map", "Convierte preguntas comerciales en mapas competitivos de precio construidos con IA.", "⌖", "green"],
  ["Alertas y reportes", "Recibe señales automáticas ante cambios de precio, surtido, stock y promociones.", "!", "orange"],
  ["Exportables para negocio", "Lleva la información a Excel, CSV y otros flujos de trabajo de tu equipo.", "↓", "green"],
] as const;

const benefits = [
  ["Equipos Comerciales", "Negocia mejor con datos competitivos actualizados.", "◎", "blue"],
  ["Marketing", "Evalúa promociones y entiende el movimiento de las marcas.", "◁", "purple"],
  ["Category Managers", "Optimiza surtido, gaps y posicionamiento de categorías.", "▤", "orange"],
  ["Equipos de Pricing", "Define precios más competitivos con evidencia de mercado.", "$", "green"],
  ["Supply / Operaciones", "Anticipa quiebres y mejora la lectura de disponibilidad.", "↻", "blue"],
] as const;

export default function LandingPage() {
  return (
    <PageChrome active="inicio">
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>PRICE INTELLIGENCE · CHILE Y LATAM</span>
              <h1>Inteligencia de precios, promociones y surtido <em>en tiempo real</em></h1>
              <p>Monitorea supermercados, farmacias y multitiendas desde una sola plataforma. Consolida información pública de mercado, automatiza el análisis y transforma miles de observaciones en decisiones comerciales más rápidas.</p>
              <div className={styles.heroActions}>
                <Link href="/landing/contacto#demo" className={styles.primaryBtn}>Agenda una demo</Link>
                <Link href="/login" className={styles.secondaryBtn}>▷ Ver plataforma</Link>
              </div>
              <div className={styles.heroTrust}><span>Datos automatizados</span><span>Cobertura multisector</span><span>Insights con IA</span></div>
            </div>
            <DashboardPreview />
          </div>
        </section>

        <div className={styles.trustStripWrap}>
          <div className={styles.trustStrip}><span>▣ Supermercados + Farmacias</span><span>▦ Dashboards en tiempo real</span><span>! Alertas automáticas</span><span>⌖ AI Price Map</span><span>◇ Brand Intelligence</span></div>
        </div>

        <section className={`${styles.section} ${styles.sectionTight}`}>
          <div className={styles.statsGrid}>
            <article className={styles.statCard}><span>↗</span><div><strong>380K+</strong><small>productos catalogados en la base</small></div></article>
            <article className={styles.statCard}><span>◎</span><div><strong>600K+</strong><small>observaciones de precio procesadas</small></div></article>
            <article className={styles.statCard}><span>⌖</span><div><strong>Multi-retail</strong><small>supermercados, farmacias y multitiendas</small></div></article>
            <article className={styles.statCard}><span>◴</span><div><strong>Continuo</strong><small>pipeline de captura y análisis automatizado</small></div></article>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="MÓDULOS" title="Todo lo que tu equipo comercial necesita" copy="Una sola plataforma para capturar, comparar, interpretar y activar información competitiva." />
          <div className={styles.featureGrid}>
            {modules.map(([title, copy, icon, tone]) => <article className={styles.featureCard} key={title}><PillIcon tone={tone}>{icon}</PillIcon><h3>{title}</h3><p>{copy}</p><Link href="/landing/modulos">Ver módulo →</Link></article>)}
          </div>
        </section>

        <section className={`${styles.highlight} ${styles.highlightPurple}`}>
          <div className={styles.highlightCopy}>
            <span>MÓDULO DESTACADO</span>
            <h2>AI Price Map</h2>
            <p>Pregunta en lenguaje natural y deja que la plataforma construya automáticamente el universo comparable y el mapa competitivo.</p>
            <ul className={styles.checkList}><li>La IA interpreta marca, categoría y formato.</li><li>Normaliza packs y precios equivalentes.</li><li>Selecciona competidores desde la base real.</li><li>Construye mapas y explica los principales hallazgos.</li></ul>
            <Link href="/landing/modulos" className={styles.outlineCta}>Conocer AI Price Map</Link>
          </div>
          <AIPriceMapPreview />
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="CÓMO FUNCIONA" title="Del dato a la decisión en 3 pasos" />
          <div className={styles.steps}>
            <article className={styles.step}><b>1</b><h3>Capturamos datos</h3><p>Nuestros procesos automatizados recopilan precios, promociones, disponibilidad y surtido desde fuentes públicas.</p></article>
            <article className={styles.step}><b>2</b><h3>Unificamos y analizamos</h3><p>Normalizamos la información, identificamos equivalencias y construimos indicadores comparables.</p></article>
            <article className={styles.step}><b>3</b><h3>Actúas con IA</h3><p>Consulta el mercado, recibe alertas y utiliza dashboards o mapas competitivos para decidir con mayor velocidad.</p></article>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="PARA QUIÉN ES" title="Beneficios para cada equipo" />
          <div className={styles.benefits}>
            {benefits.map(([title, copy, icon, tone]) => <article className={styles.benefit} key={title}><PillIcon tone={tone}>{icon}</PillIcon><h3>{title}</h3><p>{copy}</p></article>)}
          </div>
        </section>

        <BottomCTA />
      </main>
    </PageChrome>
  );
}
