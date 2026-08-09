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
    monthly: "$690.000",
    href: "/registro?plan=starter&utm_source=pricing&utm_medium=website&utm_campaign=self_service",
    cta: "Probar Starter 7 días",
    copy: "Para equipos que comienzan a profesionalizar su monitoreo competitivo.",
    features: ["Hasta 2 usuarios", "Hasta 3 retailers", "Monitoreo de precios", "Promociones y movimientos", "Dashboards estándar", "Alertas dentro de la plataforma", "20 exportaciones / mes", "Onboarding incluido"],
  },
  {
    name: "Business",
    price: "$1.490.000",
    monthly: "$1.790.000",
    href: "/registro?plan=business&utm_source=pricing&utm_medium=website&utm_campaign=self_service",
    cta: "Probar Business 7 días",
    copy: "Para equipos que necesitan inteligencia completa, IA y análisis avanzado.",
    popular: true,
    features: ["Hasta 10 usuarios", "Hasta 9 retailers", "Monitoreo avanzado", "AI Price Map", "Brand Intelligence AI", "Assortment Gaps y tendencias", "250 exportaciones / mes", "Soporte prioritario", "Onboarding incluido"],
  },
  {
    name: "Enterprise",
    price: "Desde $2.900.000",
    monthly: null,
    href: "/landing/contacto#demo",
    cta: "Hablar con ventas",
    copy: "Para organizaciones con necesidades de cobertura, gobierno o integración específicas.",
    features: ["Usuarios y cobertura a medida", "Todo lo del plan Business", "Alcances personalizados", "Integraciones dedicadas", "Modelos y análisis especiales", "Onboarding desde $1.500.000", "Soporte y SLA a definir"],
  },
];

const comparison = [
  ["Trial", "7 días", "7 días", "Piloto acordado"],
  ["Usuarios incluidos", "2", "10", "A medida"],
  ["Retailers incluidos", "Hasta 3", "Hasta 9", "A medida"],
  ["Monitoreo de precios", "✓", "✓", "✓"],
  ["Promociones y surtido", "Estándar", "Avanzado", "Avanzado"],
  ["AI Price Map", "—", "✓", "✓"],
  ["Brand Intelligence AI", "—", "✓", "✓"],
  ["Dashboards avanzados", "—", "✓", "✓"],
  ["Exportaciones", "20 / mes", "250 / mes", "A medida"],
  ["Integraciones", "—", "Según alcance", "A medida"],
  ["Soporte", "Correo", "Prioritario", "A definir"],
  ["Implementación", "Incluida", "Incluida", "Desde $1.500.000"],
];

export default function PricingPage() {
  return (
    <PageChrome active="precios">
      <main>
        <section className={styles.subHero}>
          <div className={styles.subHeroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>PRUEBA 7 DÍAS · SIN TARJETA</span>
              <h1>Empieza pequeño y escala cuando <em>veas valor</em></h1>
              <p>Prueba la plataforma con datos reales, valida el caso de uso y luego elige el nivel de cobertura, IA y soporte que necesita tu equipo.</p>
              <div className={styles.heroActions}><Link href="/registro?utm_source=pricing&utm_medium=website&utm_campaign=trial">Comenzar trial gratis</Link><Link href="/landing/contacto#demo">Solicitar demo</Link></div>
              <div className={styles.heroTrust}><span>Sin tarjeta de crédito</span><span>Onboarding inmediato</span><span>Límites visibles por plan</span></div>
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
          <SectionHeading title="Comparación de planes" copy="El precio anual es la referencia comercial recomendada. Los límites de usuarios, retailers, módulos y exportaciones se aplican en la plataforma según el plan activo." />
          <div className={styles.compareWrap}><table className={styles.compareTable}><thead><tr><th>Capacidad</th><th>Starter</th><th>Business</th><th>Enterprise</th></tr></thead><tbody>{comparison.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div>
        </section>

        <section className={styles.section}>
          <SectionHeading eyebrow="EXPANSIÓN" title="Agrega capacidad cuando la necesites" copy="La base del modelo es SaaS recurrente. Cobertura, integraciones y servicio analítico se agregan sobre el plan." />
          <div className={styles.featureGrid}>
            <article><strong>Retailer adicional</strong><p>Desde $150.000 CLP + IVA / mes según cobertura y frecuencia.</p></article>
            <article><strong>Integración o API dedicada</strong><p>Desde $750.000 de implementación + $250.000 CLP + IVA / mes.</p></article>
            <article><strong>Dashboard o reporte dedicado</strong><p>Desde $250.000 CLP + IVA / mes según complejidad.</p></article>
            <article><strong>Servicio analista MGP</strong><p>Desde $490.000 CLP + IVA / mes para interpretación y seguimiento ejecutivo.</p></article>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading title="Preguntas frecuentes" />
          <div className={styles.faqGrid}>
            <details><summary>¿Cómo funciona el trial?</summary><p>Tienes 7 días para probar el entorno inicial con hasta 3 retailers que tú eliges entre las fuentes disponibles. No pedimos tarjeta. Para prospectos calificados podemos extenderlo una sola vez hasta 7 días adicionales.</p></details>
            <details><summary>¿Qué pasa con mi configuración si contrato?</summary><p>Conservamos tu organización, industria y retailers seleccionados. El nuevo plan amplía límites y módulos sin reiniciar tu espacio de trabajo.</p></details>
            <details><summary>¿Puedo contratar mes a mes?</summary><p>Sí, en Starter y Business. La modalidad mensual tiene un precio mayor por la flexibilidad y no requiere compromiso anual.</p></details>
            <details><summary>¿Los precios incluyen IVA?</summary><p>No. Todos los valores se expresan en CLP + IVA.</p></details>
            <details><summary>¿Qué define el valor final?</summary><p>Principalmente retailers, categorías, volumen, frecuencia de actualización, usuarios, módulos e integraciones.</p></details>
            <details><summary>¿Existe una solución Enterprise?</summary><p>Sí. Parte desde $2.900.000 CLP + IVA mensuales y se configura según cobertura, gobierno, integraciones y soporte requerido.</p></details>
          </div>
        </section>

        <section className={styles.bottomCta}>
          <div className={styles.rocket}>⌂</div>
          <div><h2>¿Necesitas una solución a la medida para tu organización?</h2><p>Conversemos sobre cobertura, frecuencia, módulos, usuarios e integraciones.</p><p><a href={CONTACT_PHONE_LINK}>☎ {CONTACT_PHONE_DISPLAY}</a> · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p></div>
          <Link href="/landing/contacto#demo">Hablar con ventas</Link>
        </section>

        <BottomCTA title="Empieza con 7 días de trial" copy="Crea tu cuenta, elige tus retailers y valida MGP Super Precios con tu caso de uso." />
      </main>
    </PageChrome>
  );
}
