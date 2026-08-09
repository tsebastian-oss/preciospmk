"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./cuenta.module.css";

type Commercial = {
  commercialPlan?: string;
  trialStartedAt?: string | null;
  trialExpiresAt?: string | null;
  intendedPlan?: string | null;
  billingCycle?: string | null;
  limits?: Record<string, number | boolean | null>;
  usage?: { exportsThisMonth?: number; activeUsers?: number; pendingInvitations?: number };
};
type AccountPayload = {
  user?: { email?: string | null; displayName?: string | null; phone?: string | null; jobTitle?: string | null; company?: string | null };
  organization?: { name?: string; status?: string; plan?: string; commercialPlan?: string | null; role?: string; industryName?: string | null; industrySlug?: string | null; retailers?: string[]; modules?: string[]; limits?: Record<string, number | boolean | null>; commercial?: Commercial | null; isSaasAdmin?: boolean };
  error?: string;
};

const PLAN_LABELS: Record<string, string> = { pilot: "Trial", trial: "Trial", starter: "Starter", retail_pilot: "Starter", business: "Business", retail_intelligence: "Business", enterprise: "Enterprise" };
const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Administrador", analyst: "Analista", executive: "Ejecutivo", viewer: "Viewer" };

function daysRemaining(value?: string | null) {
  if (!value) return null;
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000));
}
function date(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date(value));
}

export default function AccountPage() {
  const [account, setAccount] = useState<AccountPayload | null>(null);
  const [error, setError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetch("/api/enterprise/account", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as AccountPayload;
        if (!response.ok) throw new Error(payload.error || "No fue posible cargar tu cuenta");
        setAccount(payload);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "No fue posible cargar tu cuenta"));
  }, []);

  async function logout() {
    setLoggingOut(true);
    try { await fetch("/api/auth/logout", { method: "POST" }); }
    finally { window.location.replace("/login"); }
  }

  if (error) return <main className={styles.page}><div className={styles.error}>{error}<Link href="/login">Volver al login</Link></div></main>;
  if (!account) return <main className={styles.page}><div className={styles.loading}>Cargando tu cuenta…</div></main>;

  const user = account.user ?? {};
  const org = account.organization ?? {};
  const commercial = org.commercial ?? {};
  const planKey = commercial.commercialPlan || org.commercialPlan || org.plan || "";
  const plan = PLAN_LABELS[planKey] || planKey || "Sin plan";
  const role = ROLE_LABELS[org.role || ""] || org.role || "Usuario";
  const trial = org.status === "trial";
  const days = daysRemaining(commercial.trialExpiresAt);
  const limits = commercial.limits ?? org.limits ?? {};
  const usage = commercial.usage ?? {};
  const exportLimit = Number(limits.exports_per_month ?? 0);
  const userLimit = Number(limits.users ?? 0);
  const exportsUsed = Number(usage.exportsThisMonth ?? 0);
  const usersUsed = Number(usage.activeUsers ?? 0);

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.top}>
        <Link href="/" className={styles.brand}><span>M</span><div><strong>MGP Super Precios</strong><small>Cuenta y organización</small></div></Link>
        <Link href="/" className={styles.back}>← Volver a la plataforma</Link>
      </header>

      <section className={styles.hero}>
        <span>MI CUENTA</span>
        <h1>{user.displayName || "Usuario"}</h1>
        <p>Administra tus datos, el alcance de tu organización y la información de tu plan.</p>
        {trial && <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, background: days !== null && days <= 2 ? "#fff4e8" : "#f2f7ff", border: "1px solid #dbe8f8", fontSize: 13 }}><strong>{days === 0 ? "Tu trial vence hoy" : days === null ? "Trial activo" : `${days} día${days === 1 ? "" : "s"} restantes`}</strong>{commercial.trialExpiresAt && <span> · vence el {date(commercial.trialExpiresAt)}</span>} · <Link href="/landing/precios">ver planes</Link></div>}
      </section>

      <div className={styles.grid}>
        <article className={styles.card}>
          <header><div><span>01</span><div><h2>Perfil</h2><p>Datos asociados a tu acceso.</p></div></div></header>
          <dl>
            <div><dt>Nombre</dt><dd>{user.displayName || "—"}</dd></div>
            <div><dt>Email</dt><dd>{user.email || "—"}</dd></div>
            <div><dt>Teléfono</dt><dd>{user.phone || "No informado"}</dd></div>
            <div><dt>Cargo</dt><dd>{user.jobTitle || "No informado"}</dd></div>
          </dl>
        </article>

        <article className={styles.card}>
          <header><div><span>02</span><div><h2>Organización</h2><p>Tu empresa y permisos de acceso.</p></div></div></header>
          <dl>
            <div><dt>Empresa</dt><dd>{org.name || user.company || "—"}</dd></div>
            <div><dt>Rol</dt><dd>{role}</dd></div>
            <div><dt>Industria</dt><dd>{org.industryName || org.industrySlug || "Sin configurar"}</dd></div>
            <div><dt>Estado</dt><dd><span className={trial ? styles.trial : styles.active}>{trial ? "Trial" : "Activo"}</span></dd></div>
          </dl>
          <Link href="/onboarding?change=1" className={styles.action}>Cambiar industria y retailers →</Link>
        </article>

        <article className={styles.card}>
          <header><div><span>03</span><div><h2>Plan y uso</h2><p>Límites y consumo real de tu cuenta.</p></div></div></header>
          <div className={styles.plan}><small>PLAN ACTUAL</small><strong>{plan}</strong><p>{trial ? "Tu organización está utilizando el acceso de prueba." : "Tu organización tiene acceso activo a la plataforma."}</p></div>
          <dl>
            <div><dt>Usuarios</dt><dd>{usersUsed}{userLimit > 0 ? ` / ${userLimit}` : ""}</dd></div>
            <div><dt>Exportaciones este mes</dt><dd>{exportsUsed}{exportLimit > 0 ? ` / ${exportLimit}` : ""}</dd></div>
            {trial && <div><dt>Vencimiento trial</dt><dd>{date(commercial.trialExpiresAt)}</dd></div>}
            {commercial.intendedPlan && <div><dt>Plan de interés</dt><dd>{PLAN_LABELS[commercial.intendedPlan] || commercial.intendedPlan}</dd></div>}
          </dl>
          <Link href="/landing/precios" className={styles.action}>{trial ? "Comparar planes y continuar →" : "Revisar planes →"}</Link>
        </article>

        <article className={styles.card}>
          <header><div><span>04</span><div><h2>Retailers monitoreados</h2><p>Alcance habilitado para tu organización.</p></div></div></header>
          <div className={styles.tags}>{(org.retailers ?? []).length ? org.retailers!.map((retailer) => <span key={retailer}>{retailer}</span>) : <p>Sin retailers configurados.</p>}</div>
          <Link href="/onboarding?change=1" className={styles.action}>Configurar alcance →</Link>
        </article>
      </div>

      <section className={styles.support}>
        <div><span>SOPORTE</span><h2>¿Necesitas ayuda o quieres continuar después del trial?</h2><p>Escríbenos y revisamos acceso, plan, retailers o cualquier problema de la plataforma.</p></div>
        <div><a href="mailto:sebastian@mgpconsultoria.cl">sebastian@mgpconsultoria.cl</a><a href="https://wa.me/56982315934" target="_blank" rel="noreferrer">WhatsApp +56 9 8231 5934</a></div>
      </section>

      <footer className={styles.footer}><button onClick={logout} disabled={loggingOut}>{loggingOut ? "Cerrando sesión…" : "Cerrar sesión"}</button></footer>
    </div>
  </main>;
}
