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
  description: "Dashboards, AI Price Map, Brand Intelligence AI, alertas, exportaciones y scraping automatizado.",
};

const modules = [
  ["Dashboards", "KPIs, tendencias, filtros y comparativos con actualización automatizada.", "▦", "blue"],
  ["AI Price Map", "Preguntas en lenguaje natural que terminan en mapas competitivos construidos con datos reales.", "⌖", "purple"],
  ["Brand Intelligence AI", "Analiza marcas, competencia, precios, promociones, surtido y disponibilidad mediante IA.", "◇", "green"],
  ["Alertas", "Prioriza variaciones de precio, promociones, brechas y cambios relevantes dentro de la plataforma.", "!", "orange"],
  ["Reportes", "Salidas ejecutivas y entregables configurables según el alcance del cliente.", "▤", "blue"],
  ["Exportaciones", "Lleva datos a Excel y CSV respetando los límites y permisos de tu plan.", "↓", "green"],
  ["Scraping Automatizado", "Pipeline de captura y actualización de catálogos y precios desde fuentes públicas.", "⌁", "blue"],
] as const;

export default function ModulesPage() {
  return (
    <PageChrome active="modulos">
      <main>
        <section className={styles.subHero}>
          <div className={styles.subHeroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>SUITE DE INTELIGENCIA COMERCIAL</span>
              <h1>Todos los módulos para inteligencia de precios <em>con datos actualizados automáticamente</em></h1>
              <p>Una suite conectada para monitorear mercado, interpretar cambios y transformar información competitiva en acciones para pricing, marketing, category management y ventas.</p>
              <div className={styles.heroActions}><Link href="/landing/contacto#demo" className={styles.primaryBtn}>Agenda una demo</Link><Link href="/registro" className={styles.secondaryBtn}>Crear cuenta trial</Link></div>
              <div className={styles.heroTrust}><span>Datos automatizados</span><span>IA conectada a la base</span><span>Permisos por plan</span></div>
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
          <SectionHeading title="Conoce todos nuestros módulos" copy="Cada módulo resuelve una parte del problema; el acceso visible en la plataforma depende del plan y alcance de cada organización." />
          <div className={styles.featureGrid}>
            {modules.map(([title, copy, icon, tone]) => <article className={styles.featureCard} key={title}><PillIcon tone={tone}>{icon}</PillIcon><h3>{title}</h3><p>{copy}</p><Link href="/landing/contacto#demo">Ver módulo →</Link></article>)}
          </div>
        </section>

        <section className={`${styles.highlight} ${styles.highlightPurple}`}>
          <div className={styles.highlightCopy}>
            <span>MÓDULO DESTACADO · BUSINESS</span><h2>AI Price Map</h2>
            <p>El usuario describe la pregunta comercial y la IA detecta marca, formato, categoría y comparables para construir una lectura visual del posicionamiento de precios.</p>
            <ul className={styles.checkList}><li>Mapa de burbujas competitivo.</li><li>Normalización de packs cuando la unidad es comparable.</li><li>Competidores seleccionados desde datos reales.</li><li>Detalle de precio, cobertura, stock, promociones y SKU utilizados.</li></ul>
            <Link className={styles.outlineCta} href="/registro?plan=business">Probar AI Price Map</Link>
          </div>
          <AIPriceMapPreview />
        </section>

        <section className={styles.highlight}>
          <div className={styles.highlightCopy}>
            <span>MÓDULO DESTACADO · BUSINESS</span><h2>Brand Intelligence AI</h2>
            <p>Pregunta “¿cómo está Nivea?” o “¿qué está pasando con Becker?” y recibe un diagnóstico construido sobre los datos disponibles para la marca y el alcance de tu organización.</p>
            <ul className={styles.checkList}><li>Precios y dispersión por retailer.</li><li>Promociones y disponibilidad.</li><li>Comparación competitiva contextual.</li><li>Historial de conversaciones por usuario.</li></ul>
            <Link className={styles.outlineCta} href="/registro?plan=business">Probar Brand Intelligence</Link>
          </div>
          <BrandPreview />
        </section>

        <section className={styles.section}>
          <SectionHeading title="Integraciones y exportaciones" copy="Lleva la información al flujo de trabajo de tu equipo. Las integraciones dedicadas se habilitan según el plan y proyecto contratado." />
          <div className={styles.featureGrid}>
            {[["CSV","▤","blue"],["Excel","X","green"],["BigQuery","◈","blue"],["API","</>","purple"],["Power BI","▥","orange"],["Looker Studio","◎","blue"],["Slack","#","purple"]].map(([title,icon,tone]) => <article className={styles.featureCard} key={title}><PillIcon tone={tone as "blue"|"green"|"purple"|"orange"}>{icon}</PillIcon><h3>{title}</h3><p>{title === "CSV" || title === "Excel" ? "Disponible dentro de la plataforma según los límites del plan." : "Disponible mediante configuración o implementación específica del cliente."}</p></article>)}
          </div>
          <div className={styles.securityNote}><b>◎</b><div><strong>¿Necesitas una integración personalizada?</strong><p>Podemos diseñar una salida o conector para tu flujo de trabajo. Cuéntanos qué sistema utilizas y qué datos necesitas.</p><Link href="/landing/contacto" className={styles.outlineCta}>Hablemos</Link></div></div>
        </section>

        <BottomCTA title="Prueba los módulos con tu propio alcance" copy="Crea un trial de 7 días o agenda una demo para revisar el caso de uso con MGP." />
      </main>
    </PageChrome>
  );
}
