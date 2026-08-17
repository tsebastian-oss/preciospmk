import Link from "next/link";
import {
  BottomCTA,
  DashboardPreview,
  PageChrome,
  PillIcon,
  SectionHeading,
} from "./MarketingShell";
import styles from "./marketing.module.css";

export const metadata = {
  title: "MGP Super Precios | Inteligencia de precios y mercado",
  description: "Analiza evolución y brechas de precios, categorías, productos, marcas y mercado automotriz con datos actualizados automáticamente.",
};

const modules = [
  ["Asistente & Inicio", "Resumen ejecutivo y consultas con IA sobre la información disponible en tu alcance.", "✦", "blue"],
  ["Evolución de precios", "Revisa el histórico por marca, producto y retailer.", "⌁", "blue"],
  ["Brechas de precio", "Identifica diferencias entre retailers sobre universos comparables.", "⇄", "purple"],
  ["Movimientos y alertas", "Detecta alzas y bajas de precio en el mercado monitoreado.", "!", "orange"],
  ["Análisis de categorías", "Analiza composición, marcas, productos y mix por retailer.", "◒", "green"],
  ["Productos", "Consulta precios actuales con filtros de marca y producto.", "□", "blue"],
  ["Brands", "Sigue competencia, precios, productos, retailers y listings de marcas.", "◆", "purple"],
  ["Mercado automotriz", "Compara modelos, versiones, bonos, precio final y variaciones semanales.", "◇", "green"],
  ["Descarga de bases", "Descarga CSV preparado para trabajar en Excel.", "↓", "green"],
  ["Estado de datos", "Revisa freshness y actividad de las fuentes monitoreadas.", "↻", "blue"],
] as const;

const benefits = [
  ["Pricing", "Sigue evolución, brechas y movimientos de precio.", "$", "green"],
  ["Category Management", "Entiende composición y dinámica de categorías.", "◒", "purple"],
  ["E-commerce", "Consulta productos y precios observados por retailer.", "□", "blue"],
  ["Marcas", "Monitorea presencia, competencia y precios en la vertical Brands.", "◆", "orange"],
  ["Automotriz", "Lee estructura de precios y variaciones por marca, modelo y versión.", "◇", "blue"],
] as const;

export default function LandingPage() {
  return (
    <PageChrome active="inicio">
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>INTELIGENCIA DE PRECIOS · DATOS DE MERCADO</span>
              <h1>Entiende cómo se mueve el mercado <em>con datos actualizados automáticamente</em></h1>
              <p>MGP Super Precios reúne información pública de mercado y la convierte en vistas para analizar evolución y brechas de precios, categorías, productos, marcas y el mercado automotriz.</p>
              <div className={styles.heroActions}>
                <Link href="/registro" className={styles.primaryBtn}>Probar 7 días</Link>
                <Link href="/landing/demo" className={styles.secondaryBtn}>▷ Ver demo del producto</Link>
              </div>
              <div className={styles.heroTrust}><span>Histórico de precios</span><span>Cobertura transparente</span><span>Asistente contextual con IA</span></div>
              <p style={{ marginTop: 16, fontSize: 11 }}><Link href="/landing/cobertura">Revisar cobertura actual →</Link> · <Link href="/landing/contacto#demo">Coordinar una demo con MGP →</Link></p>
            </div>
            <DashboardPreview />
          </div>
        </section>

        <div className={styles.trustStripWrap}>
          <div className={styles.trustStrip}><span>⌁ Evolución de precios</span><span>⇄ Brechas de precio</span><span>◒ Análisis de categorías</span><span>◆ Brands</span><span>◇ Automotriz</span><span>↓ CSV para Excel</span></div>
        </div>

        <section className={`${styles.section} ${styles.sectionTight}`}>
          <div className={styles.statsGrid}>
            <article className={styles.statCard}><span>⌁</span><div><strong>Histórico</strong><small>evolución de precios por período</small></div></article>
            <article className={styles.statCard}><span>◒</span><div><strong>Categorías</strong><small>mix, marcas, productos y retailers</small></div></article>
            <article className={styles.statCard}><span>◆</span><div><strong>Brands + Automotriz</strong><small>verticales especializadas Enterprise</small></div></article>
            <article className={styles.statCard}><span>↓</span><div><strong>Datos exportables</strong><small>CSV preparado para Excel</small></div></article>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="CAPACIDADES ACTUALES" title="Lo que puedes hacer hoy en la plataforma" copy="Esta lista refleja los módulos y vistas actualmente disponibles en MGP Super Precios." />
          <div className={styles.featureGrid}>
            {modules.map(([title, copy, icon, tone]) => <article className={styles.featureCard} key={title}><PillIcon tone={tone}><>{icon}</></PillIcon><h3>{title}</h3><p>{copy}</p><Link href="/landing/modulos">Ver detalle →</Link></article>)}
          </div>
        </section>

        <section className={`${styles.highlight} ${styles.highlightPurple}`}>
          <div className={styles.highlightCopy}>
            <span>ASISTENTE & INICIO</span>
            <h2>Una lectura ejecutiva conectada a los datos de la plataforma</h2>
            <p>La vista inicial combina indicadores del mercado con un asistente contextual para consultar la información disponible en tu organización.</p>
            <ul className={styles.checkList}><li>Consulta en lenguaje natural.</li><li>Contexto basado en los datos disponibles.</li><li>Acceso rápido a los análisis de precios y mercado.</li><li>Sin inventar cobertura fuera de las fuentes monitoreadas.</li></ul>
            <Link href="/landing/demo" className={styles.outlineCta}>Ver demo del producto</Link>
          </div>
          <DashboardPreview compact />
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="CÓMO FUNCIONA" title="Del dato público al análisis en 3 pasos" />
          <div className={styles.steps}>
            <article className={styles.step}><b>1</b><h3>Capturamos</h3><p>Los procesos automatizados recopilan precios y catálogo desde las fuentes públicas monitoreadas.</p></article>
            <article className={styles.step}><b>2</b><h3>Consolidamos</h3><p>La información se estructura para construir históricos, categorías, productos y comparaciones disponibles.</p></article>
            <article className={styles.step}><b>3</b><h3>Analizas</h3><p>Usas las vistas de la plataforma, el asistente contextual y las exportaciones para tomar decisiones.</p></article>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="PARA QUIÉN ES" title="Una plataforma para distintos equipos" />
          <div className={styles.benefits}>
            {benefits.map(([title, copy, icon, tone]) => <article className={styles.benefit} key={title}><PillIcon tone={tone}><>{icon}</></PillIcon><h3>{title}</h3><p>{copy}</p></article>)}
          </div>
        </section>

        <BottomCTA title="Valida la plataforma con tu propio mercado" copy="Revisa la cobertura, crea un trial o coordina una demo acompañada con MGP." />
      </main>
    </PageChrome>
  );
}
