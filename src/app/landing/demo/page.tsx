import Link from "next/link";
import { BottomCTA, PageChrome } from "../MarketingShell";
import marketing from "../marketing.module.css";
import DemoExperience from "./DemoExperience";

export const metadata = {
  title: "Demo interactiva | MGP Super Precios",
  description: "Recorre una vista demostrativa del dashboard, AI Price Map y Brand Intelligence antes de crear una cuenta.",
};

export default function DemoPage() {
  return <PageChrome active="inicio">
    <main>
      <section className={marketing.subHero}>
        <div className={marketing.subHeroInner}>
          <div className={marketing.heroCopy}>
            <span className={marketing.eyebrow}>DEMO INTERACTIVA · SIN LOGIN</span>
            <h1>Mira cómo funciona antes de <em>crear tu cuenta</em></h1>
            <p>Recorre los tres momentos más importantes del producto. La demo usa información ilustrativa; el trial trabaja con datos del alcance que elijas durante onboarding.</p>
            <div className={marketing.heroActions}><Link href="/registro" className={marketing.primaryBtn}>Crear trial 7 días</Link><Link href="/landing/cobertura" className={marketing.secondaryBtn}>Ver cobertura real</Link></div>
            <div className={marketing.heroTrust}><span>Sin login</span><span>Sin tarjeta</span><span>Trial con datos reales</span></div>
          </div>
          <div className={marketing.visibleMenu}>
            <Link href="#demo"><span>▦</span><div><strong>Dashboard</strong><small>KPIs y lectura ejecutiva del mercado.</small></div><b>›</b></Link>
            <Link href="#demo"><span>⌖</span><div><strong>AI Price Map</strong><small>Mapa competitivo construido desde una pregunta.</small></div><b>›</b></Link>
            <Link href="#demo"><span>◇</span><div><strong>Brand Intelligence</strong><small>Análisis conversacional de marca.</small></div><b>›</b></Link>
            <Link href="/landing/precios"><span>$</span><div><strong>Planes</strong><small>Starter, Business y Enterprise.</small></div><b>›</b></Link>
          </div>
        </div>
      </section>
      <section id="demo"><DemoExperience /></section>
      <BottomCTA title="¿Quieres probarlo con tu mercado?" copy="Crea una cuenta trial, elige hasta 3 retailers y valida el producto con tu propio alcance." />
    </main>
  </PageChrome>;
}
