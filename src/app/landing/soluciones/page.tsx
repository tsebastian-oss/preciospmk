import Link from "next/link";
import {
  BottomCTA,
  DashboardPreview,
  PageChrome,
  PillIcon,
  SectionHeading,
} from "../MarketingShell";
import styles from "../marketing.module.css";

export const metadata = {
  title: "Soluciones | MGP Super Precios",
  description: "Soluciones de inteligencia de precios para supermercados, farmacias, multitiendas, marcas y equipos comerciales.",
};

const solutions = [
  ["Supermercados", "Más competitividad en precios, promociones y surtido para cada categoría.", ["Monitoreo de precios", "Análisis de promociones", "Surtido y disponibilidad", "Benchmark competitivo"], "▣", "blue"],
  ["Farmacias", "Control de precios, disponibilidad y actividad promocional del canal farma.", ["Monitoreo de precios", "Disponibilidad de productos", "Gestión de promociones", "Competencia y mercado"], "✚", "green"],
  ["Multitiendas", "Visibilidad de catálogos online para categorías, marcas y retailers monitoreados.", ["Precios por retailer", "Promociones centralizadas", "Cobertura de catálogo", "Estandarización y control"], "▤", "purple"],
  ["Brand Intelligence", "Entiende cómo se posiciona tu marca y dónde aparecen oportunidades competitivas.", ["Cobertura de marca", "Monitoreo de competidores", "Categorías y tendencias", "Análisis con IA"], "◇", "purple"],
  ["Pricing Intelligence", "Ajusta tu estrategia con evidencia de mercado y comparables normalizados cuando las unidades son equivalentes.", ["Índices de precio", "Brechas competitivas", "Mapas de posicionamiento", "Alertas de oportunidad"], "$", "green"],
  ["Reportes Ejecutivos", "Dashboards y exportaciones que convierten datos operativos en señales para la dirección.", ["KPIs actualizados automáticamente", "Dashboards ejecutivos", "Exportaciones Excel y CSV", "Entregables a medida"], "↗", "orange"],
] as const;

const menu = [
  ["Supermercados", "Optimiza precios, promociones y surtido para cada categoría.", "▣"],
  ["Farmacias", "Monitorea precio, stock y actividad promocional en el canal farma.", "✚"],
  ["Multitiendas", "Compara catálogos online en los retailers disponibles.", "▤"],
  ["Brand Intelligence", "Monitorea marca, competencia, promociones y disponibilidad.", "◇"],
  ["Pricing Intelligence", "Convierte el mercado en índices, brechas y acciones de pricing.", "$"],
  ["Reportes Ejecutivos", "KPIs y exportaciones listos para compartir y decidir.", "↗"],
] as const;

export default function SolutionsPage() {
  return (
    <PageChrome active="soluciones">
      <main>
        <section className={styles.subHero}>
          <div className={styles.subHeroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>SOLUCIONES POR INDUSTRIA Y CASO DE USO</span>
              <h1>La solución correcta para cada <em>industria y desafío comercial</em></h1>
              <p>Gana visibilidad, competitividad y velocidad de decisión con inteligencia de precios, promociones, surtido y marca adaptada a la realidad de cada equipo.</p>
              <div className={styles.heroActions}><Link href="/landing/contacto#demo" className={styles.primaryBtn}>Solicitar demo</Link><Link href="/registro" className={styles.secondaryBtn}>Crear cuenta trial</Link></div>
              <div className={styles.heroTrust}><span>Datos automatizados</span><span>Cobertura visible</span><span>IA aplicada a negocio</span></div>
              <p style={{ marginTop: 18, fontSize: 12 }}><Link href="/landing/cobertura">Revisar retailers disponibles →</Link></p>
            </div>
            <div className={styles.visibleMenu}>
              {menu.map(([title, copy, icon]) => <Link href="#soluciones" key={title}><span>{icon}</span><div><strong>{title}</strong><small>{copy}</small></div><b>›</b></Link>)}
            </div>
          </div>
        </section>

        <section id="soluciones" className={styles.section}>
          <SectionHeading title="Nuestras soluciones por industria" copy="Una misma base de inteligencia, adaptada a las preguntas comerciales de cada negocio." />
          <div className={styles.sixGrid}>
            {solutions.map(([title, copy, bullets, icon, tone]) => <article className={styles.solutionCard} key={title}><PillIcon tone={tone}>{icon}</PillIcon><h3>{title}</h3><p>{copy}</p><ul>{bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul><Link href="/landing/contacto#demo">Ver solución →</Link></article>)}
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading title="De los datos a la decisión en cada industria" copy="Transformamos problemas repetitivos de mercado en una vista operativa y accionable." />
          <div className={styles.decisionGrid}>
            <div className={styles.challengeTable}>
              <div className={styles.challengeHead}><span>Desafío común</span><span>Cómo lo resolvemos</span></div>
              {[
                ["Precios desactualizados y poca visibilidad", "Monitoreo automatizado del mercado y comparables consolidados."],
                ["Promociones difíciles de medir", "Lectura de profundidad promocional, frecuencia y brechas por cadena."],
                ["Surtido y disponibilidad sin control", "Cobertura de catálogo, stock y gaps de presencia por retailer."],
                ["Decisiones basadas en intuición", "Dashboards, alertas dentro de la plataforma y asistentes IA conectados a los datos disponibles."],
                ["Demasiado tiempo analizando", "Automatización de captura, normalización y generación de insights."],
              ].map(([problem, answer]) => <div className={styles.challengeRow} key={problem}><strong>{problem}</strong><p>{answer}</p></div>)}
            </div>
            <DashboardPreview compact />
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading title="Beneficios por sector" copy="Información útil para decidir, no otra capa de reportes manuales." />
          <div className={styles.benefitSix}>
            {[
              ["Más competitividad", "Detecta cambios y responde con mejor información.", "◎", "blue"],
              ["Mayor rentabilidad", "Identifica brechas de precio y promociones relevantes.", "$", "green"],
              ["Ahorro de tiempo", "Automatiza captura, consolidación y lectura del mercado.", "◴", "purple"],
              ["Menos riesgo", "Prioriza variaciones, quiebres y movimientos atípicos.", "!", "orange"],
              ["Mejores decisiones", "Trabaja con una fuente común para todo el equipo.", "⌖", "blue"],
              ["Crecimiento sostenible", "Escala el análisis sin multiplicar tareas manuales.", "↗", "green"],
            ].map(([title, copy, icon, tone]) => <article className={styles.benefit} key={title}><PillIcon tone={tone as "blue" | "green" | "purple" | "orange"}>{icon}</PillIcon><h3>{title}</h3><p>{copy}</p></article>)}
          </div>
        </section>

        <BottomCTA title="Impulsa tu industria con inteligencia comercial actualizada automáticamente" copy="Solicita una demo y revisemos juntos qué fuentes, categorías y marcas quieres monitorear." />
      </main>
    </PageChrome>
  );
}
