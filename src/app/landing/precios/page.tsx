import Link from "next/link";
import {
  BottomCTA,
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_LINK,
  DashboardPreview,
  PageChrome,
  SectionHeading,
} from "../MarketingShell";
import styles from "../marketing.module.css";

export const metadata = {
  title: "Precios | MGP Super Precios",
  description: "Planes Starter, Business y Enterprise según las capacidades actualmente disponibles en MGP Super Precios.",
};

const plans = [
  {
    name: "Starter",
    price: "$590.000",
    monthly: "$690.000",
    href: "/registro?plan=starter&utm_source=pricing&utm_medium=website&utm_campaign=self_service",
    cta: "Probar Starter 7 días",
    copy: "Para equipos que necesitan monitoreo de precios y acceso a la base operativa del producto.",
    features: ["Hasta 2 usuarios", "Hasta 3 retailers", "Asistente & Inicio", "Evolución de precios", "Brechas de precio", "Movimientos y alertas", "Productos", "Estado de datos", "20 exportaciones CSV / mes", "Onboarding incluido"],
  },
  {
    name: "Business",
    price: "$1.490.000",
    monthly: "$1.790.000",
    href: "/registro?plan=business&utm_source=pricing&utm_medium=website&utm_campaign=self_service",
    cta: "Probar Business 7 días",
    copy: "Para equipos que además necesitan profundizar el análisis por categoría.",
    popular: true,
    features: ["Hasta 10 usuarios", "Hasta 9 retailers", "Todo lo de Starter", "Análisis de categorías", "250 exportaciones CSV / mes", "Soporte prioritario", "Onboarding incluido"],
  },
  {
    name: "Enterprise",
    price: "Desde $2.900.000",
    monthly: null,
    href: "/landing/contacto#demo",
    cta: "Hablar con ventas",
    copy: "Para organizaciones que necesitan las verticales Brands o Automotriz y un alcance definido a medida.",
    features: ["Usuarios y cobertura a medida", "Todo lo de Business", "Vertical Brands", "Mercado automotriz", "Alcance y permisos a medida", "Onboarding desde $1.500.000", "Soporte y SLA a definir"],
  },
];

const comparison = [
  ["Trial", "7 días", "7 días", "Piloto acordado"],
  ["Usuarios incluidos", "2", "10", "A medida"],
  ["Retailers incluidos", "Hasta 3", "Hasta 9", "A medida"],
  ["Asistente & Inicio", "✓", "✓", "✓"],
  ["Evolución de precios", "✓", "✓", "✓"],
  ["Brechas de precio", "✓", "✓", "✓"],
  ["Movimientos y alertas", "✓", "✓", "✓"],
  ["Productos", "✓", "✓", "✓"],
  ["Análisis de categorías", "—", "✓", "✓"],
  ["Brands", "—", "—", "✓"],
  ["Mercado automotriz", "—", "—", "✓"],
  ["Descarga CSV", "20 / mes", "250 / mes", "A medida"],
  ["Estado de datos", "✓", "✓", "✓"],
  ["Soporte", "Correo", "Prioritario", "A definir"],
];

export default function PricingPage() {
  return (
    <PageChrome active="precios">
      <main>
        <section className={styles.subHero}>
          <div className={styles.subHeroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>PRUEBA 7 DÍAS · SIN TARJETA</span>
              <h1>Elige el plan según <em>los módulos que realmente necesitas</em></h1>
              <p>Los planes se diferencian por usuarios, retailers, exportaciones y acceso a las capacidades actuales de la plataforma.</p>
              <div className={styles.heroActions}><Link href="/registro?utm_source=pricing&utm_medium=website&utm_campaign=trial">Comenzar trial gratis</Link><Link href="/landing/contacto#demo">Solicitar demo</Link></div>
              <div className={styles.heroTrust}><span>Sin tarjeta de crédito</span><span>Hasta 3 retailers en trial</span><span>Módulos visibles por plan</span></div>
              <p style={{ marginTop: 18, fontSize: 12 }}><Link href="/landing/cobertura">Ver cobertura actual de retailers →</Link></p>
            </div>
            <DashboardPreview compact />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.pricingToggle}><strong>Precio objetivo con compromiso anual</strong><span className={styles.saving}>Mejor valor</span><span>· Mensual flexible disponible en Starter y Business</span></div>
          <div className={styles.pricingGrid}>
            {plans.map((plan) => <article className={`${styles.priceCard} ${plan.popular ? styles.pricePopular : ""}`} key={plan.name}>{plan.popular && <span className={styles.popularTag}>PLAN OBJETIVO</span>}<h3>{plan.name}</h3><p>{plan.copy}</p><div className={styles.price}>{plan.price}<small> CLP + IVA / mes</small></div><small>{plan.monthly ? <>Mensual sin permanencia: <strong>{plan.monthly} CLP + IVA</strong></> : "Valor base; alcance final según propuesta"}</small><Link href={plan.href}>{plan.cta}</Link><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul></article>)}
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading title="Comparación de planes" copy="Los límites de usuarios, retailers, módulos y exportaciones se aplican en la plataforma según el plan activo." />
          <div className={styles.compareWrap}><table className={styles.compareTable}><thead><tr><th>Capacidad</th><th>Starter</th><th>Business</th><th>Enterprise</th></tr></thead><tbody>{comparison.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div>
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="QUÉ CAMBIA ENTRE PLANES" title="Más profundidad, no funcionalidades inventadas" copy="Starter cubre el núcleo de precios y datos; Business suma Análisis de categorías; Enterprise habilita Brands y Mercado automotriz." />
          <div className={styles.featureGrid}>
            <article><strong>Starter</strong><p>Asistente, evolución, brechas, movimientos y alertas, productos, descargas y estado de datos.</p></article>
            <article><strong>Business</strong><p>Todo Starter más Análisis de categorías.</p></article>
            <article><strong>Enterprise</strong><p>Todo Business más Brands y Mercado automotriz, con alcance a medida.</p></article>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading title="Preguntas frecuentes" />
          <div className={styles.faqGrid}>
            <details><summary>¿Cómo funciona el trial?</summary><p>Tienes 7 días para probar el entorno inicial con entre 1 y 3 retailers que eliges entre las fuentes disponibles. No pedimos tarjeta.</p></details>
            <details><summary>¿Qué pasa con mi configuración si contrato?</summary><p>Conservamos tu organización, industria y retailers seleccionados. El nuevo plan amplía los límites y módulos habilitados.</p></details>
            <details><summary>¿Puedo contratar mes a mes?</summary><p>Sí, en Starter y Business. La modalidad mensual tiene un precio mayor por la flexibilidad y no requiere compromiso anual.</p></details>
            <details><summary>¿Los precios incluyen IVA?</summary><p>No. Todos los valores se expresan en CLP + IVA.</p></details>
            <details><summary>¿Qué puedo descargar?</summary><p>La plataforma permite exportar bases en CSV con encabezados y formato preparado para trabajar en Excel, sujeto al límite del plan.</p></details>
            <details><summary>¿Qué incluye Enterprise?</summary><p>Incluye las capacidades de Business y habilita las verticales Brands y Mercado automotriz, con cobertura, usuarios y soporte definidos según el alcance.</p></details>
          </div>
        </section>

        <section className={styles.bottomCta}>
          <div className={styles.rocket}>⌂</div>
          <div><h2>¿Necesitas validar qué plan corresponde?</h2><p>Conversemos sobre retailers, usuarios, categorías y verticales.</p><p><a href={CONTACT_PHONE_LINK}>☎ {CONTACT_PHONE_DISPLAY}</a> · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p></div>
          <Link href="/landing/contacto#demo">Hablar con ventas</Link>
        </section>

        <BottomCTA title="Empieza con 7 días de trial" copy="Crea tu cuenta, elige tus retailers y valida las capacidades disponibles en tu plan." />
      </main>
    </PageChrome>
  );
}
