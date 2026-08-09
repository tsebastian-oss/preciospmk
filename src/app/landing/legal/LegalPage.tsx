import Link from "next/link";
import type { ReactNode } from "react";
import { PageChrome } from "../MarketingShell";
import styles from "./legal.module.css";

const legalLinks = [
  ["Privacidad y seguridad", "/landing/legal/privacidad"],
  ["Términos de uso", "/landing/legal/terminos"],
  ["Uso responsable de datos", "/landing/legal/uso-datos"],
  ["Información pública de mercado", "/landing/legal/informacion-publica"],
  ["Acceso autenticado al producto", "/landing/legal/acceso-producto"],
] as const;

export default function LegalPage({ eyebrow="LEGAL", title, intro, children }: { eyebrow?: string; title: string; intro: string; children: ReactNode }) {
  return <PageChrome active="inicio">
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h1>{title}</h1>
          <p>{intro}</p>
          <span className={styles.updated}>Última actualización: 9 de agosto de 2026</span>
        </div>
      </section>
      <div className={styles.content}>
        <nav className={styles.side} aria-label="Documentos legales">
          <strong>Documentos legales</strong>
          {legalLinks.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
        </nav>
        <article className={styles.article}>{children}
          <div className={styles.legalNav}>{legalLinks.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}</div>
        </article>
      </div>
    </main>
  </PageChrome>;
}
