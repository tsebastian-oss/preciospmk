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
  description: "Planes para equipos que necesitan monitoreo de precios, inteligencia competitiva, IA y analítica comercial.",
};

const plans = [
  {
    name: "Starter",
    price: "$590.000",
    copy: "Para equipos que comienzan a profesionalizar su monitoreo competitivo.",
    features: ["Hasta 2 usuarios", "Monitoreo de precios", "Promociones y surtido básico", "Dashboards estándar", "Alertas por correo", "Exportaciones básicas", "Soporte por correo"],
  },
  {
    name: "Business",
    price: "$1.490.000",
    copy: "Para equipos que necesitan inteligencia completa y análisis avanzado.",
    popular: true,
    features: ["Hasta 10 usuarios", "Monitoreo avanzado", "Promociones y surtido avanzado", "AI Price Map", "Brand Intelligence AI", "Dashboards personalizados", "Exportaciones avanzadas", "Soporte prioritario"],
  },
  {
    name: "Enterprise",
    price: "A medida",
    copy: "Para organizaciones con necesidades de cobertura, gobierno o integración específicas.",
    features: ["Usuarios y cobertura a medida", "Todo lo del plan Business", "Alcances personalizados", "Integraciones dedicadas", "Modelos y análisis especiales", "Onboarding y capacitación", "Soporte y SLA a definir"],
  },
];

const comparison = [
  ["Usuarios incluidos", "2", "10", "A medida"],
  ["Monitoreo de precios", "✓", "✓", "✓"],
  ["Promociones y surtido", "Básico", "Avanzado", "Avanzado"],
  ["AI Price Map", "—", "✓", "✓"],
  ["Brand Intelligence AI", "—", "✓", "✓"],
  ["Dashboards personalizados", "—", "✓", "✓"],
  ["Exportaciones avanzadas", "—", "✓", "✓"],
  ["Integraciones", "—", "Según alcance", "A medida"],
  ["Soporte", "Correo", "Prioritario", "A definir"],
  ["Implementación", "Guiada", "Guiada", "Dedicada"],
];

export default function PricingPage() {
  return (
    <PageChrome active="precios">
      <main>
        <section className={styles.subHero}>
          <div className={styles.subHeroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>PLANES PARA CADA ETAPA</span>
              <h1>Elige el plan ideal para tu <em>equipo comercial</em></h1>
              <p>Desde monitoreo competitivo para equipos pequeños hasta implementaciones enterprise con módulos de IA, alcances personalizados e integraciones.</p>
              <div className={styles.heroTrust}><span>Implementación guiada</span><span>Sin costos ocultos de uso</span><span>Soporte local</span></div>
            </div>
            <DashboardPreview compact />
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.pricingToggle}><span>Pago mensual</span><i className={styles.switch} /><strong>Pago anual</strong><span className={styles.saving}>Ahorra hasta 17%</span></div>
          <div className={styles.pricingGrid}>
            {plans.map((plan) => <article className={`${styles.priceCard} ${plan.popular ? styles.pricePopular : ""}`} key={plan.name}>{plan.popular && <span className={styles.popularTag}>MÁS POPULAR</span>}<h3>{plan.name}</h3><p>{plan.copy}</p><div className={styles.price}>{plan.price}{plan.price !== "A medida" && <small> CLP + IVA / mes</small>}</div><small>{plan.price === "A medida" ? "Propuesta personalizada" : "Valor referencial con contratación anual"}</small><Link href="/landing/contacto#demo">{plan.name === "Enterprise" ? "Hablar con ventas" : "Solicitar este plan"}</Link><ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul></article>)}
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading title="Comparación de planes" copy="El alcance final se define según número de retailers, categorías, marcas, frecuencia e integraciones requeridas." />
          <div className={styles.compareWrap}><table className={styles.compareTable}><thead><tr><th>Capacidad</th><th>Starter</th><th>Business</th><th>Enterprise</th></tr></thead><tbody>{comparison.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div>
        </section>

        <section className={styles.section}>
          <SectionHeading title="Preguntas frecuentes" />
          <div className={styles.faqGrid}>
            <details><summary>¿Puedo cambiar de plan más adelante?</summary><p>Sí. El alcance puede crecer o reducirse según cambien tus necesidades y la cobertura requerida.</p></details>
            <details><summary>¿Los precios incluyen IVA?</summary><p>No. Los valores publicados son referenciales y se expresan en CLP + IVA.</p></details>
            <details><summary>¿Qué define el valor final?</summary><p>Principalmente retailers, categorías, volumen de productos, frecuencia de actualización, usuarios, módulos e integraciones.</p></details>
            <details><summary>¿Cómo funciona el onboarding?</summary><p>Definimos alcance, usuarios y configuración inicial; luego habilitamos el entorno y acompañamos al equipo en la adopción.</p></details>
            <details><summary>¿Puedo pedir una demo antes de contratar?</summary><p>Sí. La demo permite revisar los módulos y validar el caso de uso antes de avanzar.</p></details>
            <details><summary>¿Existe una solución enterprise?</summary><p>Sí. Diseñamos coberturas, integraciones, permisos y acompañamiento de acuerdo con la organización.</p></details>
          </div>
        </section>

        <section className={styles.bottomCta}>
          <div className={styles.rocket}>⌂</div>
          <div><h2>¿Necesitas una solución a la medida para tu organización?</h2><p>Conversemos sobre cobertura, frecuencia, módulos, usuarios e integraciones.</p><p><a href={CONTACT_PHONE_LINK}>☎ {CONTACT_PHONE_DISPLAY}</a> · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p></div>
          <Link href="/landing/contacto#demo">Hablar con ventas</Link>
        </section>

        <BottomCTA title="Prueba la plataforma con tu caso de uso" copy="Agenda una demo y revisemos qué plan se ajusta mejor a tu equipo." />
      </main>
    </PageChrome>
  );
}
