"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./AccountMenu.module.css";

type AccountPayload = {
  user?: { email?: string | null; displayName?: string | null; jobTitle?: string | null };
  organization?: { name?: string; status?: string; plan?: string; commercialPlan?: string | null; role?: string; retailers?: string[]; commercial?: { trialExpiresAt?: string | null; commercialPlan?: string } | null };
  error?: string;
};

const PLAN_LABELS: Record<string, string> = { pilot: "Trial", trial: "Trial", starter: "Starter", retail_pilot: "Starter", business: "Business", retail_intelligence: "Business", enterprise: "Enterprise" };
const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Administrador", analyst: "Analista", executive: "Ejecutivo", viewer: "Viewer" };

function initials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "U";
  const words = source.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : source.slice(0, 2)).toUpperCase();
}
function daysRemaining(value?: string | null) {
  if (!value) return null;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}

export default function AccountMenu() {
  const [account, setAccount] = useState<AccountPayload | null>(null);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/enterprise/account", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as AccountPayload;
        if (!response.ok) throw new Error(payload.error || "No fue posible cargar tu cuenta");
        if (!cancelled) setAccount(payload);
      })
      .catch(() => { if (!cancelled) setAccount(null); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, []);

  const displayName = account?.user?.displayName || "Mi cuenta";
  const email = account?.user?.email || "";
  const organizationName = account?.organization?.name || "Organización";
  const role = ROLE_LABELS[account?.organization?.role || ""] || account?.organization?.role || "Usuario";
  const planKey = account?.organization?.commercial?.commercialPlan || account?.organization?.commercialPlan || account?.organization?.plan || "";
  const plan = PLAN_LABELS[planKey] || planKey || "Plan";
  const trialDays = daysRemaining(account?.organization?.commercial?.trialExpiresAt);
  const avatar = useMemo(() => initials(displayName, email), [displayName, email]);
  const canManageTeam = ["owner", "admin"].includes(account?.organization?.role || "");

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "content-type": "application/json" } });
    } finally {
      window.location.replace("/login");
    }
  }

  return <div className={styles.root} ref={rootRef}>
    {open && <div className={styles.menu} role="menu">
      <header>
        <span>{avatar}</span>
        <div><strong>{displayName}</strong><small>{email || organizationName}</small></div>
      </header>
      <div className={styles.org}><b>{organizationName}</b><small>{role} · {plan}{account?.organization?.status === "trial" && trialDays !== null ? ` · ${trialDays} días` : ""}</small></div>
      <nav>
        <Link href="/cuenta" role="menuitem"><i>◎</i><span>Mi cuenta</span></Link>
        {canManageTeam && <Link href="/cuenta/equipo" role="menuitem"><i>♙</i><span>Equipo y usuarios</span></Link>}
        <Link href="/onboarding?change=1" role="menuitem"><i>⚙</i><span>Configurar alcance</span></Link>
        {account?.organization?.status === "trial" && <Link href="/landing/precios" role="menuitem"><i>↗</i><span>Ver planes</span></Link>}
        <a href="mailto:sebastian@mgpconsultoria.cl?subject=Soporte%20MGP%20Super%20Precios" role="menuitem"><i>?</i><span>Soporte</span></a>
      </nav>
      <button className={styles.logout} type="button" onClick={logout} disabled={loggingOut} role="menuitem"><i>↪</i><span>{loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}</span></button>
    </div>}

    <button className={styles.trigger} type="button" onClick={() => setOpen((current) => !current)} aria-haspopup="menu" aria-expanded={open}>
      <div className={styles.identity}>
        <span className={styles.avatar}>{avatar}</span>
        <div><strong>{displayName}</strong></div>
        <i className={styles.chevron}>{open ? "⌃" : "⌄"}</i>
      </div>
    </button>
  </div>;
}
