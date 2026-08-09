"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./marketing.module.css";

const LINKS = [
  ["Inicio", "/landing"],
  ["Soluciones", "/landing/soluciones"],
  ["Módulos", "/landing/modulos"],
  ["Cobertura", "/landing/cobertura"],
  ["Precios", "/landing/precios"],
  ["Contacto", "/landing/contacto"],
] as const;

export default function MarketingMobileMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);

  return <div className={styles.mobileMenuRoot} ref={root}>
    <button className={styles.mobileMenuButton} type="button" onClick={() => setOpen((value) => !value)} aria-label="Abrir navegación" aria-expanded={open}>
      <span/><span/><span/>
    </button>
    {open && <div className={styles.mobileMenuPanel}>
      <nav aria-label="Navegación móvil">
        {LINKS.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)}>{label}<b>›</b></Link>)}
      </nav>
      <div className={styles.mobileMenuActions}>
        <Link href="/login" onClick={() => setOpen(false)}>Ingresar</Link>
        <Link href="/registro" onClick={() => setOpen(false)}>Crear cuenta</Link>
        <Link href="/landing/contacto#demo" onClick={() => setOpen(false)}>Solicitar demo</Link>
      </div>
    </div>}
  </div>;
}
