"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./team.module.css";

type Member = { userId: string; email: string; displayName: string; jobTitle?: string | null; role: string; status: string; joinedAt: string };
type Invitation = { id: string; email: string; role: string; status: string; expires_at: string; created_at: string };
type Account = {
  user?: { id?: string | null };
  organization?: {
    id?: string;
    name?: string;
    role?: string;
    limits?: Record<string, number | boolean | null>;
    commercial?: { limits?: Record<string, number | boolean | null>; usage?: { activeUsers?: number; pendingInvitations?: number } } | null;
  };
  error?: string;
};
type Detail = { members?: Member[]; invitations?: Invitation[]; error?: string };

const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Administrador", analyst: "Analista", executive: "Ejecutivo", viewer: "Viewer" };

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "No fue posible completar la operación.");
  return payload;
}

export default function TeamPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const nextAccount = await api<Account>("/api/enterprise/account");
    setAccount(nextAccount);
    const organizationId = nextAccount.organization?.id;
    if (!organizationId) throw new Error("No fue posible resolver la organización.");
    const nextDetail = await api<Detail>(`/api/enterprise/organization?organizationId=${encodeURIComponent(organizationId)}`);
    setDetail(nextDetail);
  }, []);

  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "No fue posible cargar el equipo.")).finally(() => setLoading(false)); }, [load]);

  const org = account?.organization;
  const canManage = ["owner", "admin"].includes(org?.role ?? "");
  const limits = org?.commercial?.limits ?? org?.limits ?? {};
  const seatLimit = Number(limits.users ?? 0);
  const members = detail?.members ?? [];
  const pending = (detail?.invitations ?? []).filter((item) => item.status === "pending");
  const consumed = members.filter((item) => item.status === "active").length + pending.length;
  const available = seatLimit > 0 ? Math.max(0, seatLimit - consumed) : null;
  const currentUserId = account?.user?.id ?? null;

  async function run(action: () => Promise<unknown>, success: string) {
    setWorking(true); setError(""); setMessage("");
    try { await action(); setMessage(success); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible completar la operación."); }
    finally { setWorking(false); }
  }

  function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!org?.id) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const role = String(form.get("role") ?? "viewer");
    if (!email) return;
    void run(() => api("/api/enterprise/organization", { method: "POST", body: JSON.stringify({ action: "inviteMember", organizationId: org.id, email, role }) }), "Invitación procesada correctamente.");
    event.currentTarget.reset();
  }

  function updateMember(member: Member, role: string, status = member.status) {
    if (!org?.id || member.userId === currentUserId) return;
    void run(() => api("/api/enterprise/organization", { method: "POST", body: JSON.stringify({ action: "updateMember", organizationId: org.id, userId: member.userId, role, status }) }), "Acceso actualizado.");
  }

  function revoke(invitation: Invitation) {
    if (!org?.id) return;
    void run(() => api("/api/enterprise/organization", { method: "POST", body: JSON.stringify({ action: "revokeInvitation", organizationId: org.id, invitationId: invitation.id }) }), "Invitación revocada.");
  }

  if (loading) return <main className={styles.page}><div className={styles.state}>Cargando equipo…</div></main>;
  if (!account || !org?.id) return <main className={styles.page}><div className={styles.state}>{error || "No fue posible cargar tu organización."}</div></main>;

  return <main className={styles.page}>
    <div className={styles.shell}>
      <header className={styles.top}><Link href="/cuenta" className={styles.brand}><span>M</span><div><strong>MGP Super Precios</strong><small>Equipo y accesos</small></div></Link><Link href="/cuenta">← Mi cuenta</Link></header>
      <section className={styles.hero}><span>EQUIPO</span><h1>{org.name}</h1><p>Administra los usuarios que pueden acceder al alcance de tu organización. Los cupos se aplican según tu plan.</p></section>

      <section className={styles.usage}>
        <article><span>Cupos utilizados</span><strong>{consumed}{seatLimit > 0 ? ` / ${seatLimit}` : ""}</strong><small>usuarios activos + invitaciones pendientes</small></article>
        <article><span>Disponibles</span><strong>{available === null ? "A medida" : available}</strong><small>antes de alcanzar el límite</small></article>
        <article><span>Tu rol</span><strong>{ROLE_LABELS[org.role ?? ""] || org.role}</strong><small>{canManage ? "puedes administrar accesos" : "sin permisos de administración"}</small></article>
      </section>

      {message && <div className={styles.success}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {canManage && <section className={styles.card}>
        <header><div><span>01</span><div><h2>Invitar usuario</h2><p>El sistema valida automáticamente el límite de asientos de tu plan.</p></div></div></header>
        <form className={styles.invite} onSubmit={invite}>
          <label>Correo corporativo<input type="email" name="email" required placeholder="persona@empresa.cl" /></label>
          <label>Rol<select name="role" defaultValue="analyst"><option value="admin">Administrador</option><option value="analyst">Analista</option><option value="executive">Ejecutivo</option><option value="viewer">Viewer</option></select></label>
          <button disabled={working || (available !== null && available <= 0)}>{available !== null && available <= 0 ? "Límite de usuarios alcanzado" : working ? "Procesando…" : "Invitar usuario"}</button>
        </form>
        {available !== null && available <= 0 && <p className={styles.upgrade}>Necesitas más usuarios. <Link href="/landing/precios">Revisa un plan superior →</Link></p>}
      </section>}

      <section className={styles.card}>
        <header><div><span>02</span><div><h2>Usuarios activos</h2><p>{members.length} usuario{members.length === 1 ? "" : "s"} asociado{members.length === 1 ? "" : "s"} a la organización.</p></div></div></header>
        <div className={styles.tableWrap}><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{members.map((member) => <tr key={member.userId}><td><strong>{member.displayName || member.email}</strong><small>{member.email}{member.jobTitle ? ` · ${member.jobTitle}` : ""}</small></td><td>{canManage && member.userId !== currentUserId ? <select value={member.role} onChange={(event) => updateMember(member, event.target.value)} disabled={working}><option value="admin">Administrador</option><option value="analyst">Analista</option><option value="executive">Ejecutivo</option><option value="viewer">Viewer</option></select> : ROLE_LABELS[member.role] || member.role}</td><td><span className={member.status === "active" ? styles.active : styles.inactive}>{member.status === "active" ? "Activo" : member.status}</span></td><td>{canManage && member.userId !== currentUserId ? <button className={styles.textButton} onClick={() => updateMember(member, member.role, member.status === "active" ? "suspended" : "active")} disabled={working}>{member.status === "active" ? "Suspender" : "Reactivar"}</button> : member.userId === currentUserId ? "Tú" : "—"}</td></tr>)}</tbody></table></div>
      </section>

      {pending.length > 0 && <section className={styles.card}>
        <header><div><span>03</span><div><h2>Invitaciones pendientes</h2><p>Reservan un cupo hasta ser aceptadas, revocadas o vencer.</p></div></div></header>
        <div className={styles.pending}>{pending.map((invitation) => <article key={invitation.id}><div><strong>{invitation.email}</strong><small>{ROLE_LABELS[invitation.role] || invitation.role} · vence {new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(new Date(invitation.expires_at))}</small></div>{canManage && <button onClick={() => revoke(invitation)} disabled={working}>Revocar</button>}</article>)}</div>
      </section>}
    </div>
  </main>;
}
