import Link from "next/link";
import { BottomCTA, PageChrome } from "../MarketingShell";
import marketing from "../marketing.module.css";
import DemoExperience from "./DemoExperience";

export const metadata = {
  title: "Demo del producto | MGP Super Precios",
  description: "Recorre una demo de las capacidades actuales: análisis de precios, categorías, Brands, automotriz, descargas y estado de datos.",
};

export default function DemoPage() {
  return <PageChrome active="inicio">
    <main>
      <section className={marketing.subHero}>
        <div className={marketing.subHeroInner}>
          <div className={marketing.heroCopy}>
            <span className={marketing.eyebrow}>DEMO DEL PRODUCTO · SIN LOGIN</span>
            <h1>Conoce las capacidades que <em>están disponibles hoy</em></h1>
            <p>Esta demo resume el producto actual. Las cifras y gráficos son ilustrativos; una cuenta trial trabaja con las fuentes reales seleccionadas durante onboarding.</p>
            <div className={marketing.heroActions}><Link href="/registro" className={marketing.primaryBtn}>Crear trial 7 días</Link><Link href="/landing/cobertura" className={marketing.secondaryBtn}>Ver cobertura real</Link></div>
            <div className={marketing.heroTrust}><span>Sin login</span><span>Sin tarjeta</span><span>Capacidades actuales</span></div>
          </div>
          <div className={marketing.visibleMenu}>
            <Link href="#demo"><span>✦</span><div><strong>Asistente & Inicio</strong><small>Resumen ejecutivo y consultas sobre los datos disponibles.</small></div><b>›</b></Link>
            <Link href="#demo"><span>⌁</span><div><strong>Análisis de precios</strong><small>Evolución, brechas, movimientos y alertas.</small></div><b>›</b></Link>
            <Link href="#demo"><span>◒</span><div><strong>Análisis de categorías</strong><small>Mix de marcas, productos y retailers.</small></div><b>›</b></Link>
            <Link href="#demo"><span>◆</span><div><strong>Verticales Enterprise</strong><small>Brands y Mercado automotriz.</small></div><b>›</b></Link>
            <Link href="/landing/precios"><span>$</span><div><strong>Planes</strong><small>Starter, Business y Enterprise.</small></div><b>›</b></Link>
          </div>
        </div>
      </section>
      <section id="demo"><DemoExperience /></section>
      <BottomCTA title="¿Quieres probarlo con tu mercado?" copy="Crea una cuenta trial, elige hasta 3 retailers disponibles y valida el producto con tu propio alcance." />
    </main>
  </PageChrome>;
}
