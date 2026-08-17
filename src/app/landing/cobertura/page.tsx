import Link from "next/link";
import { BottomCTA, PageChrome, SectionHeading } from "../MarketingShell";
import marketing from "../marketing.module.css";
import CoverageGrid from "./CoverageGrid";

export const metadata = {
  title: "Cobertura de datos | MGP Super Precios",
  description: "Revisa los retailers y canales actualmente monitoreados por MGP Super Precios y el estado operativo de sus datos.",
};

export default function CoveragePage() {
  return <PageChrome active="cobertura">
    <main>
      <section className={marketing.subHero}>
        <div className={marketing.subHeroInner}>
          <div className={marketing.heroCopy}>
            <span className={marketing.eyebrow}>COBERTURA TRANSPARENTE</span>
            <h1>Antes de probar, revisa <em>qué fuentes están disponibles</em></h1>
            <p>Esta página muestra la cobertura operativa de los canales de retail actualmente conectados. El estado visible en la grilla es la referencia para saber qué fuentes tienen datos utilizables.</p>
            <div className={marketing.heroActions}><Link href="/registro" className={marketing.primaryBtn}>Crear cuenta trial</Link><Link href="/landing/contacto#demo" className={marketing.secondaryBtn}>Solicitar demo</Link></div>
            <div className={marketing.heroTrust}><span>Cobertura desde datos reales</span><span>Estado operativo visible</span><span>Fuentes en revisión identificadas</span></div>
          </div>
          <div className={marketing.visibleMenu}>
            <Link href="#cobertura"><span>▣</span><div><strong>Supermercados</strong><small>Fuentes disponibles para precios, productos y análisis de mercado.</small></div><b>›</b></Link>
            <Link href="#cobertura"><span>✚</span><div><strong>Farmacias</strong><small>Fuentes del canal farma con estado de actualización visible.</small></div><b>›</b></Link>
            <Link href="#cobertura"><span>▤</span><div><strong>Multitiendas</strong><small>Catálogos online y precios observados por retailer.</small></div><b>›</b></Link>
            <Link href="#cobertura"><span>⌂</span><div><strong>Hogar y construcción</strong><small>Fuentes visibles cuando cuentan con cobertura operativa en la plataforma.</small></div><b>›</b></Link>
            <Link href="/landing/legal/informacion-publica"><span>◎</span><div><strong>Cómo interpretamos los datos</strong><small>Alcance, limitaciones y uso responsable.</small></div><b>›</b></Link>
          </div>
        </div>
      </section>
      <section id="cobertura" className={marketing.section}>
        <SectionHeading eyebrow="COBERTURA ACTUAL" title="Retailers visibles en la plataforma" copy="La grilla se alimenta desde la capa operativa de datos. Una fuente en revisión se muestra como tal en vez de presentarse como plenamente actualizada." />
        <CoverageGrid />
      </section>
      <section className={marketing.section}>
        <SectionHeading title="Qué significa tener cobertura" copy="Una fuente con datos utilizables puede alimentar las vistas que correspondan al plan y al alcance de tu organización." />
        <div className={marketing.featureGrid}>
          <article><strong>Precios y productos</strong><p>La información disponible puede consultarse en las vistas de productos y análisis de precios.</p></article>
          <article><strong>Categorías</strong><p>Cuando el alcance y el plan lo permiten, los datos alimentan Análisis de categorías.</p></article>
          <article><strong>Estado de datos</strong><p>La plataforma permite revisar la actualidad de las fuentes antes de interpretar los resultados.</p></article>
        </div>
      </section>
      <BottomCTA title="¿Tu retailer prioritario está disponible?" copy="Crea un trial y elige hasta 3 retailers disponibles, o solicita una demo si necesitas revisar un alcance específico." />
    </main>
  </PageChrome>;
}
