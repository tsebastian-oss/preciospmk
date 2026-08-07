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
  description: "Solicita una demo de MGP Super Precios o cuéntanos qué retailers, categorías y marcas quieres monitorear.",
};

export default function ContactPage() {
  return (
    <PageChrome active="contacto">
      <main>
        <section className={styles.subHero}>
          <div className={styles.subHeroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>CONECTEMOS PARA GENERAR MÁS VALOR</span>
              <h1>Hablemos sobre cómo transformar tus decisiones de precios <em>con datos en tiempo real</em></h1>
              <p>Cuéntanos tu caso de uso y revisaremos cómo MGP Super Precios puede ayudarte a monitorear mercado, competencia, precios, promociones, surtido y marcas.</p>
              <div className={styles.heroTrust}><span>Respuesta rápida</span><span>Información protegida</span><span>Asesoría especializada</span></div>
            </div>
            <DashboardPreview compact />
          </div>
        </section>

        <section className={styles.section} id="demo">
          <div className={styles.contactGrid}>
            <article className={styles.contactCard}>
              <h2>Envíanos un mensaje</h2><p>Completa el formulario. Si quieres una demo, puedes indicar una fecha y horario preferidos.</p>
              <ContactForm />
              <div className={styles.securityNote}><b>✓</b><div><strong>Uso de la información</strong><p>Los datos enviados se utilizan únicamente para responder esta solicitud comercial y coordinar el contacto.</p></div></div>
            </article>
            <aside className={styles.contactAside}>
              <h2>O contáctanos directamente</h2><p>Elige el canal que te resulte más cómodo.</p>
              <div className={styles.contactMethods}>
                <a className={styles.contactMethod} href={CONTACT_WHATSAPP} target="_blank" rel="noreferrer"><span>☎</span><div><strong>Teléfono / WhatsApp</strong><small>{CONTACT_PHONE_DISPLAY}</small></div></a>
                <a className={styles.contactMethod} href={`mailto:${CONTACT_EMAIL}`}><span>✉</span><div><strong>Correo electrónico</strong><small>{CONTACT_EMAIL}</small></div></a>
                <a className={styles.contactMethod} href="#coordinar"><span>◴</span><div><strong>Agenda una demo</strong><small>Selecciona un canal y coordinamos el horario.</small></div></a>
                <Link className={styles.contactMethod} href="/login"><span>↗</span><div><strong>Acceso a clientes</strong><small>Ingresa a la plataforma privada.</small></div></Link>
              </div>
            </aside>
          </div>
        </section>

        <section className={`${styles.section} ${styles.sectionTight}`} id="coordinar">
          <SectionHeading title="Agenda una demostración personalizada" copy="La demo se adapta a tu industria, retailers y preguntas de negocio." />
          <div className={styles.schedulerGrid}>
            <article className={styles.schedulerCard}>
              <h2>Demo MGP Super Precios</h2><p>Reserva aproximadamente 45 minutos para revisar el producto, tus necesidades de cobertura y los módulos más relevantes.</p>
              <div className={styles.availability}><span>Pricing Intelligence</span><span>AI Price Map</span><span>Brand Intelligence AI</span><span>Promociones</span><span>Surtido</span><span>Exportaciones</span></div>
              <div className={styles.demoButtons}><a href={`${CONTACT_WHATSAPP}?text=Hola%20Sebasti%C3%A1n%2C%20quiero%20coordinar%20una%20demo%20de%20MGP%20Super%20Precios`} target="_blank" rel="noreferrer">Coordinar por WhatsApp</a><a href={`mailto:${CONTACT_EMAIL}?subject=Solicitud%20de%20demo%20MGP%20Super%20Precios`}>Coordinar por correo</a></div>
            </article>
            <article className={styles.schedulerCard}>
              <h2>Atención en Chile y LatAm</h2><p>La implementación, demos y soporte comercial pueden realizarse de forma remota para equipos distribuidos.</p>
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
            <details><summary>¿Qué información necesito para iniciar?</summary><p>Idealmente tus retailers, categorías o marcas prioritarias y las preguntas que quieres resolver. Con eso podemos proponer un alcance inicial.</p></details>
            <details><summary>¿Cuánto demora una implementación?</summary><p>Depende del alcance, número de fuentes y configuración. En la demo podemos estimar un plan realista para tu caso.</p></details>
            <details><summary>¿MGP Super Precios puede integrarse con otros sistemas?</summary><p>Sí. Existen exportaciones y se pueden evaluar integraciones específicas según el plan y las necesidades del cliente.</p></details>
            <details><summary>¿Ofrecen capacitación y soporte?</summary><p>Sí. El onboarding y acompañamiento se ajustan al plan contratado y al nivel de complejidad de la implementación.</p></details>
          </div>
        </section>

        <BottomCTA title="Da el siguiente paso hacia decisiones más inteligentes" copy="Coordina una demo y revisemos cómo aplicar la plataforma a tu mercado." />
      </main>
    </PageChrome>
  );
}
