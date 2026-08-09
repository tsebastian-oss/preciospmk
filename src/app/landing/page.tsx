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
  description: "Monitorea precios, promociones, surtido y competencia con dashboards e inteligencia artificial.",
};

const modules = [
  ["Scraping automatizado", "Capturamos precios, promociones y surtido de miles de productos mediante procesos automatizados.", "⌁", "blue"],
  ["Dashboards dinámicos", "Visualiza KPIs, tendencias y comparativas con actualización automatizada y filtros avanzados.", "▦", "blue"],
  ["Brand Intelligence", "Monitorea tu marca, la competencia, promociones, disponibilidad y posicionamiento.", "◇", "purple"],
  ["AI Price Map", "Convierte preguntas comerciales en mapas competitivos de precio construidos con IA.", "⌖", "green"],
  ["Alertas dentro de la plataforma", "Prioriza cambios de precio, surtido, stock y promociones que requieren atención.", "!", "orange"],
  ["Exportables para negocio", "Lleva la información a Excel y CSV respetando los permisos de tu plan.", "↓", "green"],
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
              <h1>Inteligencia de precios, promociones y surtido <em>con actualización automatizada</em></h1>
              <p>Monitorea supermercados, farmacias y multitiendas desde una sola plataforma. Consolida información pública de mercado, automatiza el análisis y transforma miles de observaciones en decisiones comerciales más rápidas.</p>
              <div className={styles.heroActions}>
                <Link href="/registro" className={styles.primaryBtn}>Probar 7 días</Link>
                <Link href="/landing/demo" className={styles.secondaryBtn}>▷ Ver demo interactiva</Link>
              </div>
              <div className={styles.heroTrust}><span>Sin tarjeta</span><span>Cobertura transparente</span><span>Insights con IA</span></div>
              <p style={{ marginTop: 16, fontSize: 11 }}><Link href="/landing/cobertura">Revisar cobertura actual →</Link> · <Link href="/landing/contacto#demo">Coordinar una demo con MGP →</Link></p>
            </div>
            <DashboardPreview />
          </div>
        </section>

        <div className={styles.trustStripWrap}>
          <div className={styles.trustStrip}><span>▣ Supermercados + Farmacias + Multitiendas</span><span>▦ Dashboards con actualización automatizada</span><span>! Alertas dentro de la plataforma</span><span>⌖ AI Price Map</span><span>◇ Brand Intelligence</span></div>
        </div>

        <section className={`${styles.section} ${styles.sectionTight}`}>
          <div className={styles.statsGrid}>
            <article className={styles.statCard}><span>↗</span><div><strong>380K+</strong><small>productos catalogados en la base</small></div></article>
            <article className={styles.statCard}><span>◎</span><div><strong>600K+</strong><small>observaciones de precio procesadas</small></div></article>
            <article className={styles.statCard}><span>⌖</span><div><strong>Multi-retail</strong><small>supermercados, farmacias y multitiendas</small></div></article>
            <article className={styles.statCard}><span>◴</span><div><strong>Automatizado</strong><small>pipeline de captura y análisis</small></div></article>
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
            <span>MÓDULO DESTACADO · BUSINESS</span>
            <h2>AI Price Map</h2>
            <p>Pregunta en lenguaje natural y deja que la plataforma construya automáticamente el universo comparable y el mapa competitivo.</p>
            <ul className={styles.checkList}><li>La IA interpreta marca, categoría y formato.</li><li>Normaliza packs y precios equivalentes cuando la unidad es comparable.</li><li>Selecciona competidores desde la base real.</li><li>Construye mapas y explica los principales hallazgos.</li></ul>
            <Link href="/landing/demo" className={styles.outlineCta}>Ver AI Price Map en la demo</Link>
          </div>
          <AIPriceMapPreview />
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="CÓMO FUNCIONA" title="Del dato a la decisión en 3 pasos" />
          <div className={styles.steps}>
            <article className={styles.step}><b>1</b><h3>Capturamos datos</h3><p>Nuestros procesos automatizados recopilan precios, promociones, disponibilidad y surtido desde fuentes públicas.</p></article>
            <article className={styles.step}><b>2</b><h3>Unificamos y analizamos</h3><p>Normalizamos la información e identificamos equivalencias cuando existen unidades comparables.</p></article>
            <article className={styles.step}><b>3</b><h3>Actúas con IA</h3><p>Consulta el mercado, revisa señales y utiliza dashboards o mapas competitivos para decidir con mayor velocidad.</p></article>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="PARA QUIÉN ES" title="Beneficios para cada equipo" />
          <div className={styles.benefits}>
            {benefits.map(([title, copy, icon, tone]) => <article className={styles.benefit} key={title}><PillIcon tone={tone}>{icon}</PillIcon><h3>{title}</h3><p>{copy}</p></article>)}
          </div>
        </section>

        <BottomCTA title="Valida la plataforma con tu propio mercado" copy="Revisa la cobertura, crea un trial o coordina una demo acompañada con MGP." />
      </main>
    </PageChrome>
  );
}
