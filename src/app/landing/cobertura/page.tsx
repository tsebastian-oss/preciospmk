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
            <h1>Antes de probar, revisa <em>qué datos están disponibles</em></h1>
            <p>Publicamos la cobertura operativa de supermercados, farmacias, multitiendas y hogar/construcción para que puedas validar si tus cadenas prioritarias están disponibles antes de crear una cuenta.</p>
            <div className={marketing.heroActions}><Link href="/registro" className={marketing.primaryBtn}>Crear cuenta trial</Link><Link href="/landing/contacto#demo" className={marketing.secondaryBtn}>Solicitar demo</Link></div>
            <div className={marketing.heroTrust}><span>Datos de cobertura automáticos</span><span>Estado operativo visible</span><span>Sin claims ocultos</span></div>
          </div>
          <div className={marketing.visibleMenu}>
            <Link href="#cobertura"><span>▣</span><div><strong>Supermercados</strong><small>Precios, promociones, surtido y disponibilidad pública.</small></div><b>›</b></Link>
            <Link href="#cobertura"><span>✚</span><div><strong>Farmacias</strong><small>Cobertura del canal farma con actualización automatizada.</small></div><b>›</b></Link>
            <Link href="#cobertura"><span>▤</span><div><strong>Multitiendas</strong><small>Catálogos online y señales comerciales por retailer.</small></div><b>›</b></Link>
            <Link href="#cobertura"><span>⌂</span><div><strong>Hogar y construcción</strong><small>Easy y Sodimac integrados al catálogo, precios y disponibilidad.</small></div><b>›</b></Link>
            <Link href="/landing/legal/informacion-publica"><span>◎</span><div><strong>Cómo interpretamos los datos</strong><small>Alcance, limitaciones y uso responsable.</small></div><b>›</b></Link>
          </div>
        </div>
      </section>
      <section id="cobertura" className={marketing.section}>
        <SectionHeading eyebrow="COBERTURA ACTUAL" title="Retailers visibles en la plataforma" copy="El estado se alimenta desde la capa operativa de datos. Una fuente en revisión se muestra como tal en vez de presentarse como plenamente actualizada." />
        <CoverageGrid />
      </section>
      <BottomCTA title="¿Tu retailer prioritario está disponible?" copy="Crea un trial y elige hasta 3 retailers, o solicita una demo si necesitas un alcance específico." />
    </main>
  </PageChrome>;
}
