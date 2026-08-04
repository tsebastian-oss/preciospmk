import Link from "next/link";
import styles from "./landing.module.css";

const features = [
  ["Pricing Intelligence", "Compara precios efectivos, promociones y brechas entre cadenas."],
  ["Assortment Tracking", "Detecta productos nuevos, modificados, eliminados y reactivados."],
  ["Daily Market Crawls", "Mantén un histórico diario del mercado con trazabilidad por corrida."],
  ["Executive Visibility", "Convierte miles de SKU en señales claras para decisiones comerciales."],
];

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/landing" className={styles.brand}>
          <span>M</span>
          <div><strong>MGP Retail</strong><small>Intelligence Platform</small></div>
        </Link>
        <Link href="/login" className={styles.login}>Ingresar</Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>RETAIL INTELLIGENCE · CHILE</span>
          <h1>Transforma precios públicos en decisiones comerciales.</h1>
          <p>
            Monitorea precios, promociones, disponibilidad y cambios de surtido de los principales supermercados desde una sola plataforma privada.
          </p>
          <div className={styles.actions}>
            <Link href="/login" className={styles.primary}>Ingresar a la plataforma</Link>
            <a href="#capacidades" className={styles.secondary}>Conocer capacidades</a>
          </div>
        </div>

        <div className={styles.visual} aria-hidden>
          <div className={styles.visualTop}><span>Market intelligence</span><b>LIVE</b></div>
          <div className={styles.pulse}>
            <i /><i /><i /><i /><i /><i /><i /><i />
          </div>
          <div className={styles.visualRows}>
            <div><span>Pricing signals</span><strong>Always on</strong></div>
            <div><span>Assortment changes</span><strong>Tracked daily</strong></div>
            <div><span>Competitive gaps</span><strong>Actionable</strong></div>
          </div>
        </div>
      </section>

      <section className={styles.logos}>
        <span>Monitoreo competitivo para</span>
        <div><b>Lider</b><b>Jumbo</b><b>Santa Isabel</b></div>
      </section>

      <section className={styles.features} id="capacidades">
        <div className={styles.sectionHeading}>
          <span>CAPACIDADES</span>
          <h2>Una vista continua del mercado.</h2>
          <p>La información sensible permanece dentro de un entorno autenticado.</p>
        </div>
        <div className={styles.grid}>
          {features.map(([title, copy], index) => (
            <article key={title}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.cta}>
        <div><span>PRIVATE ACCESS</span><h2>Tu inteligencia comercial, protegida.</h2></div>
        <Link href="/login" className={styles.primary}>Ingresar con credenciales</Link>
      </section>

      <footer className={styles.footer}>
        <span>MGP Retail Intelligence</span>
        <small>Información competitiva para uso autorizado.</small>
      </footer>
    </main>
  );
}
