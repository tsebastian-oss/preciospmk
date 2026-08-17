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
  title: "Módulos | MGP Super Precios",
  description: "Conoce las capacidades actuales: asistente, evolución y brechas de precios, categorías, productos, Brands, automotriz, descargas y estado de datos.",
};

const modules = [
  ["Asistente & Inicio", "Resumen ejecutivo y consultas con IA sobre los datos disponibles para tu organización.", "✦", "blue"],
  ["Evolución de precios", "Histórico de precios por marca, producto, retailer y período.", "⌁", "blue"],
  ["Brechas de precio", "Diferencias de precio entre retailers sobre universos comparables.", "⇄", "purple"],
  ["Movimientos y alertas", "Alzas y bajas de precio detectadas en la información monitoreada.", "!", "orange"],
  ["Análisis de categorías", "Evolución, mix de marcas, productos y composición por retailer.", "◒", "green"],
  ["Productos", "Consulta de precios actuales con filtros por marca, producto y período cuando corresponde.", "□", "blue"],
  ["Brands", "Overview, competencia, precios, productos, retailers y listings para marcas monitoreadas.", "◆", "purple"],
  ["Mercado automotriz", "Marca, modelo, versión, fuente, precio lista, bonos, precio final y variaciones semanales.", "◇", "green"],
  ["Descarga de bases", "Exportación CSV con encabezados, preparada para trabajar en Excel.", "↓", "green"],
  ["Estado de datos", "Freshness y actividad de las fuentes que alimentan la plataforma.", "↻", "blue"],
] as const;

export default function ModulesPage() {
  return (
    <PageChrome active="modulos">
      <main>
        <section className={styles.subHero}>
          <div className={styles.subHeroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>CAPACIDADES ACTUALES</span>
              <h1>Estos son los módulos y vistas que <em>existen hoy en la plataforma</em></h1>
              <p>Sin funcionalidades futuras ni promesas adicionales: esta página describe el producto que un usuario puede utilizar actualmente según su plan y alcance.</p>
              <div className={styles.heroActions}><Link href="/landing/contacto#demo" className={styles.primaryBtn}>Solicitar demo</Link><Link href="/registro" className={styles.secondaryBtn}>Crear cuenta trial</Link></div>
              <div className={styles.heroTrust}><span>Producto real</span><span>Datos actualizados automáticamente</span><span>Acceso según plan</span></div>
            </div>
            <DashboardPreview compact />
          </div>
        </section>

        <section id="catalogo" className={styles.section}>
          <SectionHeading title="Capacidades disponibles" copy="El acceso visible depende del plan activo y de las fuentes configuradas para cada organización." />
          <div className={styles.featureGrid}>
            {modules.map(([title, copy, icon, tone]) => <article className={styles.featureCard} key={title}><PillIcon tone={tone}><>{icon}</></PillIcon><h3>{title}</h3><p>{copy}</p><Link href="/landing/contacto#demo">Ver en una demo →</Link></article>)}
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="ANÁLISIS DE PRECIOS" title="Histórico, brechas y movimientos" copy="Las vistas de precios trabajan sobre los datos disponibles para la organización y permiten filtrar el universo de análisis." />
          <div className={styles.sixGrid}>
            <article className={styles.solutionCard}><PillIcon tone="blue">⌁</PillIcon><h3>Evolución de precios</h3><p>Histórico por marca, producto y retailer para revisar cómo cambia el precio observado en el tiempo.</p></article>
            <article className={styles.solutionCard}><PillIcon tone="purple">⇄</PillIcon><h3>Brechas de precio</h3><p>Comparación de diferencias de precio cuando existe un universo comparable entre retailers.</p></article>
            <article className={styles.solutionCard}><PillIcon tone="orange">!</PillIcon><h3>Movimientos y alertas</h3><p>Lectura de alzas y bajas detectadas para priorizar cambios relevantes.</p></article>
          </div>
        </section>

        <section className={`${styles.highlight} ${styles.highlightPurple}`}>
          <div className={styles.highlightCopy}>
            <span>ANÁLISIS DE MERCADO</span><h2>Análisis de categorías y productos</h2>
            <p>La plataforma incorpora una vista de Category Intelligence y un explorador de productos conectados a la capa analítica actual.</p>
            <ul className={styles.checkList}><li>Evolución de la categoría.</li><li>Mix de marcas.</li><li>Composición de productos por retailer.</li><li>Productos y precios actuales.</li></ul>
            <Link className={styles.outlineCta} href="/landing/contacto#demo">Ver análisis de mercado</Link>
          </div>
          <DashboardPreview compact />
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="VERTICALES ENTERPRISE" title="Brands y Mercado automotriz" copy="Son verticales específicas de la plataforma, disponibles en Enterprise según el alcance contratado." />
          <div className={styles.featureGrid}>
            <article className={styles.featureCard}><PillIcon tone="purple">◆</PillIcon><h3>Brands</h3><p>Overview de marca, competencia, precios, productos, retailers y listings para entender dónde se vende y cómo compite una marca.</p></article>
            <article className={styles.featureCard}><PillIcon tone="green">◇</PillIcon><h3>Mercado automotriz</h3><p>Catálogo dealer-first con modelos, versiones, estructura de bonos, precio final, Entry/Mid/Top y variaciones por marca.</p></article>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="DATOS Y OPERACIÓN" title="Descargas y estado de actualización" />
          <div className={styles.featureGrid}>
            <article className={styles.featureCard}><PillIcon tone="green">↓</PillIcon><h3>CSV para Excel</h3><p>Descarga bases desde la plataforma en CSV con encabezados y formato preparado para abrir en Excel.</p></article>
            <article className={styles.featureCard}><PillIcon tone="blue">↻</PillIcon><h3>Estado de datos</h3><p>Revisa la actualidad y actividad de las fuentes monitoreadas antes de interpretar un resultado.</p></article>
          </div>
        </section>

        <BottomCTA title="Revisa el producto tal como funciona hoy" copy="Crea un trial de 7 días o solicita una demo para revisar los módulos disponibles para tu plan." />
      </main>
    </PageChrome>
  );
}
