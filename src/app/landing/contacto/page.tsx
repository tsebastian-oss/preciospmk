import Link from "next/link";
import {
  BottomCTA,
  CONTACT_EMAIL,
  CONTACT_PHONE_DISPLAY,
  CONTACT_PHONE_LINK,
  CONTACT_WHATSAPP,
  DashboardPreview,
  PageChrome,
  SectionHeading,
} from "../MarketingShell";
import styles from "../marketing.module.css";
import ContactForm from "./ContactForm";

export const metadata = {
  title: "Contacto | MGP Super Precios",
  description: "Solicita una demo de MGP Super Precios para revisar precios, categorías, productos, Brands, automotriz y datos disponibles.",
};

export default function ContactPage() {
  return (
    <PageChrome active="contacto">
      <main>
        <section className={styles.subHero}>
          <div className={styles.subHeroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>HABLEMOS DE TU MERCADO</span>
              <h1>Revisa cómo MGP Super Precios puede ayudarte <em>con las capacidades actuales del producto</em></h1>
              <p>Cuéntanos qué retailers, categorías, productos, marcas o mercado automotriz quieres analizar y revisaremos qué cobertura y módulos están disponibles.</p>
              <div className={styles.heroTrust}><span>Cobertura verificable</span><span>Módulos actuales</span><span>Demo personalizada</span></div>
            </div>
            <DashboardPreview compact />
          </div>
        </section>

        <section className={styles.section} id="demo">
          <div className={styles.contactGrid}>
            <article className={styles.contactCard}>
              <h2>Envíanos un mensaje</h2><p>Completa el formulario. Si quieres una demo, indica una fecha y horario preferidos para coordinarla.</p>
              <ContactForm />
              <div className={styles.securityNote}><b>✓</b><div><strong>Uso de la información</strong><p>Los datos enviados se utilizan únicamente para responder esta solicitud comercial y coordinar el contacto.</p></div></div>
            </article>
            <aside className={styles.contactAside}>
              <h2>O contáctanos directamente</h2><p>Elige el canal que te resulte más cómodo.</p>
              <div className={styles.contactMethods}>
                <a className={styles.contactMethod} href={CONTACT_WHATSAPP} target="_blank" rel="noreferrer"><span>☎</span><div><strong>Teléfono / WhatsApp</strong><small>{CONTACT_PHONE_DISPLAY}</small></div></a>
                <a className={styles.contactMethod} href={`mailto:${CONTACT_EMAIL}`}><span>✉</span><div><strong>Correo electrónico</strong><small>{CONTACT_EMAIL}</small></div></a>
                <a className={styles.contactMethod} href="#coordinar"><span>◴</span><div><strong>Coordina una demo</strong><small>Indica tu disponibilidad y coordinamos el horario.</small></div></a>
                <Link className={styles.contactMethod} href="/login"><span>↗</span><div><strong>Acceso a clientes</strong><small>Ingresa a la plataforma privada.</small></div></Link>
              </div>
            </aside>
          </div>
        </section>

        <section className={`${styles.section} ${styles.sectionTight}`} id="coordinar">
          <SectionHeading title="Coordina una demostración personalizada" copy="La demo se adapta a las fuentes y capacidades que corresponden a tu caso de uso." />
          <div className={styles.schedulerGrid}>
            <article className={styles.schedulerCard}>
              <h2>Demo MGP Super Precios</h2><p>Reserva aproximadamente 45 minutos para revisar el producto, la cobertura disponible y los módulos relevantes para tu equipo.</p>
              <div className={styles.availability}><span>Asistente & Inicio</span><span>Evolución de precios</span><span>Brechas de precio</span><span>Movimientos y alertas</span><span>Análisis de categorías</span><span>Productos</span><span>Brands</span><span>Automotriz</span><span>Descarga CSV</span><span>Estado de datos</span></div>
              <div className={styles.demoButtons}><a href={`${CONTACT_WHATSAPP}?text=Hola%2C%20quiero%20coordinar%20una%20demo%20de%20MGP%20Super%20Precios`} target="_blank" rel="noreferrer">Coordinar por WhatsApp</a><a href={`mailto:${CONTACT_EMAIL}?subject=Solicitud%20de%20demo%20MGP%20Super%20Precios`}>Coordinar por correo</a></div>
            </article>
            <article className={styles.schedulerCard}>
              <h2>Atención en Chile y LatAm</h2><p>Las demos y el soporte comercial pueden realizarse de forma remota para equipos distribuidos.</p>
              <div className={styles.contactMethods}>
                <a className={styles.contactMethod} href={CONTACT_PHONE_LINK}><span>CL</span><div><strong>Chile</strong><small>{CONTACT_PHONE_DISPLAY}</small></div></a>
                <a className={styles.contactMethod} href={`mailto:${CONTACT_EMAIL}`}><span>LA</span><div><strong>Latinoamérica</strong><small>Coordinación por correo y videollamada</small></div></a>
              </div>
            </article>
          </div>
        </section>

        <section className={styles.section}>
          <SectionHeading title="Preguntas frecuentes" />
          <div className={styles.faqGrid}>
            <details><summary>¿Qué información necesito para iniciar?</summary><p>Idealmente tus retailers, categorías, productos o marcas prioritarias y las preguntas que quieres resolver. Con eso podemos validar qué datos están disponibles.</p></details>
            <details><summary>¿Qué incluye la demo?</summary><p>Revisamos las vistas actuales de la plataforma que correspondan a tu plan y caso de uso, junto con la cobertura de fuentes disponible.</p></details>
            <details><summary>¿Qué puedo exportar?</summary><p>La plataforma permite descargar bases en CSV preparado para Excel, respetando los filtros, permisos y límites del plan activo.</p></details>
            <details><summary>¿Ofrecen onboarding y soporte?</summary><p>Sí. El onboarding y el soporte se aplican según el plan contratado y el alcance definido para la organización.</p></details>
          </div>
        </section>

        <BottomCTA title="Revisa el producto con tu caso de uso" copy="Coordina una demo y validemos cobertura, módulos y datos disponibles para tu mercado." />
      </main>
    </PageChrome>
  );
}
