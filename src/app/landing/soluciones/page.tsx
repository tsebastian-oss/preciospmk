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
  description: "Soluciones actuales para análisis de precios, categorías, productos, marcas, automotriz y operación de datos.",
};

const solutions = [
  ["Análisis de precios", "Sigue el comportamiento del precio observado y prioriza movimientos relevantes.", ["Evolución de precios", "Brechas de precio", "Movimientos y alertas", "Filtros por marca, producto y período"], "⌁", "blue"],
  ["Análisis de categorías", "Entiende la composición y evolución de las categorías disponibles en tu alcance.", ["Evolución de categoría", "Mix de marcas", "Mix de productos por retailer", "Lectura visual con gráficos y heatmaps"], "◒", "green"],
  ["Productos", "Consulta el mercado a nivel producto con precios actuales y filtros.", ["Precio observado", "Marca y producto", "Retailer", "Período cuando aplica"], "□", "purple"],
  ["Brands", "Monitorea una marca desde una vertical dedicada.", ["Overview", "Competencia", "Precios", "Productos, retailers y listings"], "◆", "purple"],
  ["Mercado automotriz", "Analiza estructura de precio y variaciones desde concesionarios chilenos.", ["Marca, modelo y versión", "Precio lista y bonos", "Precio final", "Variación semanal y por marca"], "◇", "green"],
  ["Datos y operación", "Accede a la información y revisa su estado antes de tomar decisiones.", ["Descarga CSV para Excel", "Estado de datos", "Freshness de fuentes", "Configuración por organización"], "↓", "orange"],
] as const;

const menu = [
  ["Precios", "Evolución, brechas y movimientos detectados.", "⌁"],
  ["Categorías", "Composición, marcas y productos por retailer.", "◒"],
  ["Productos", "Precios actuales del catálogo monitoreado.", "□"],
  ["Brands", "Seguimiento de marcas, competencia y presencia.", "◆"],
  ["Automotriz", "Modelos, versiones, bonos y variaciones.", "◇"],
  ["Datos", "Descarga y estado de actualización.", "↓"],
] as const;

export default function SolutionsPage() {
  return (
    <PageChrome active="soluciones">
      <main>
        <section className={styles.subHero}>
          <div className={styles.subHeroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>SOLUCIONES BASADAS EN EL PRODUCTO ACTUAL</span>
              <h1>Analiza precios y mercado con <em>las capacidades que hoy existen</em></h1>
              <p>MGP Super Precios organiza la información disponible en seis frentes concretos: precios, categorías, productos, Brands, automotriz y datos/operación.</p>
              <div className={styles.heroActions}><Link href="/landing/contacto#demo" className={styles.primaryBtn}>Solicitar demo</Link><Link href="/registro" className={styles.secondaryBtn}>Crear cuenta trial</Link></div>
              <div className={styles.heroTrust}><span>Datos automatizados</span><span>Cobertura visible</span><span>Producto verificable</span></div>
              <p style={{ marginTop: 18, fontSize: 12 }}><Link href="/landing/cobertura">Revisar retailers disponibles →</Link></p>
            </div>
            <div className={styles.visibleMenu}>
              {menu.map(([title, copy, icon]) => <Link href="#soluciones" key={title}><span>{icon}</span><div><strong>{title}</strong><small>{copy}</small></div><b>›</b></Link>)}
            </div>
          </div>
        </section>

        <section id="soluciones" className={styles.section}>
          <SectionHeading title="Soluciones disponibles" copy="Cada solución corresponde a una vista o vertical actualmente implementada en la plataforma." />
          <div className={styles.sixGrid}>
            {solutions.map(([title, copy, bullets, icon, tone]) => <article className={styles.solutionCard} key={title}><PillIcon tone={tone}><>{icon}</></PillIcon><h3>{title}</h3><p>{copy}</p><ul>{bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul><Link href="/landing/contacto#demo">Ver en una demo →</Link></article>)}
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading title="De la pregunta a la vista correcta" copy="La plataforma evita mezclar capacidades: cada necesidad se resuelve en el módulo que corresponde." />
          <div className={styles.decisionGrid}>
            <div className={styles.challengeTable}>
              <div className={styles.challengeHead}><span>Pregunta de negocio</span><span>Dónde se responde</span></div>
              {[
                ["¿Cómo ha evolucionado este precio?", "Evolución de precios."],
                ["¿Dónde existe una brecha relevante?", "Brechas de precio."],
                ["¿Qué subió o bajó?", "Movimientos y alertas."],
                ["¿Cómo está compuesta esta categoría?", "Análisis de categorías."],
                ["¿Qué precio tiene este producto?", "Productos."],
                ["¿Cómo compite y dónde aparece una marca?", "Brands."],
                ["¿Cómo se estructura el precio de un vehículo?", "Mercado automotriz."],
                ["¿Puedo llevarme los datos?", "Descarga de bases en CSV para Excel."],
              ].map(([problem, answer]) => <div className={styles.challengeRow} key={problem}><strong>{problem}</strong><p>{answer}</p></div>)}
            </div>
            <DashboardPreview compact />
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading title="Una misma base, distintos equipos" copy="El valor está en usar una fuente común para responder preguntas distintas sin multiplicar análisis manuales." />
          <div className={styles.benefitSix}>
            {[
              ["Pricing", "Histórico, brechas y movimientos.", "$", "green"],
              ["Category", "Composición y evolución de categorías.", "◒", "purple"],
              ["E-commerce", "Productos y precios actuales.", "□", "blue"],
              ["Marketing / Marca", "Vertical Brands para competencia y presencia.", "◆", "orange"],
              ["Automotriz", "Estructura de precios y variaciones.", "◇", "blue"],
              ["Data", "CSV para Excel y estado de fuentes.", "↓", "green"],
            ].map(([title, copy, icon, tone]) => <article className={styles.benefit} key={title}><PillIcon tone={tone as "blue" | "green" | "purple" | "orange"}>{icon}</PillIcon><h3>{title}</h3><p>{copy}</p></article>)}
          </div>
        </section>

        <BottomCTA title="Revisa qué solución corresponde a tu caso" copy="Solicita una demo y validemos juntos las fuentes, módulos y verticales disponibles para tu organización." />
      </main>
    </PageChrome>
  );
}
