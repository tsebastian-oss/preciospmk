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

export default function MarketingMobileNav() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return <div className={styles.mobileNavRoot} ref={root}>
    <button
      type="button"
      className={styles.mobileMenuButton}
      aria-label={open ? "Cerrar menú" : "Abrir menú"}
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
    >
      <span/><span/><span/>
    </button>
    {open && <div className={styles.mobileMenu}>
      <nav aria-label="Navegación móvil">
        {LINKS.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)}>{label}<span>›</span></Link>)}
      </nav>
      <div className={styles.mobileMenuActions}>
        <Link href="/login" onClick={() => setOpen(false)}>Ingresar</Link>
        <Link href="/registro" onClick={() => setOpen(false)}>Crear cuenta</Link>
        <Link href="/landing/contacto#demo" onClick={() => setOpen(false)}>Solicitar demo</Link>
      </div>
    </div>}
  </div>;
}
