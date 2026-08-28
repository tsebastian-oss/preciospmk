"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./usage.module.css";

type Summary = {
  users: number; organizations: number; sessions: number; activeMinutes: number; avgSessionMinutes: number;
  pageViews: number; events: number; chatQueries: number; downloads: number; activeNow: number; lastActivity: string | null;
};
type Organization = {
  organizationId: string; organizationName: string; status: string; plan: string; users: number; sessions: number;
  activeMinutes: number; pageViews: number; lastSeenAt: string;
};
type ModuleUsage = { module: string; events: number };
type UserUsage = {
  userId: string; email: string; displayName: string | null; jobTitle: string | null; organizationId: string; organizationName: string;
  sessions: number; activeMinutes: number; avgSessionMinutes: number; pageViews: number; events: number; chatQueries: number; downloads: number;
  firstSeenAt: string; lastSeenAt: string; activeNow: boolean; topModules: ModuleUsage[];
};
type EventItem = {
  id: number; createdAt: string; eventName: string; module: string | null; path: string | null; durationMs: number;
  metadata: Record<string, unknown>; userId: string; email: string; displayName: string | null; organizationId: string; organizationName: string;
};
type Payload = { days: number; summary: Summary; organizations: Organization[]; users: UserUsage[]; recentEvents: EventItem[]; error?: string };

const dt = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" });
const number = new Intl.NumberFormat("es-CL");
function fmtDate(value: string | null | undefined) { return value ? dt.format(new Date(value)) : "—"; }
function minutes(value: number | null | undefined) {
  const n = Number(value || 0);
  if (n < 60) return `${Math.round(n)} min`;
  return `${(n / 60).toLocaleString("es-CL", { maximumFractionDigits: 1 })} h`;
}
function eventLabel(name: string) {
  const labels: Record<string,string> = {
    session_start: "Inicio de sesión", page_view: "Vista de página", heartbeat: "Actividad", session_end: "Fin de sesión",
    click: "Click", module_view: "Módulo", chat_submit: "Consulta IA", download: "Descarga", filter_change: "Filtro"
  };
  return labels[name] || name;
}

export default function UsageAdminPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [days, setDays] = useState("30");
  const [organizationId, setOrganizationId] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"users"|"events">("users");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ days });
      if (organizationId) params.set("organizationId", organizationId);
      const response = await fetch("/api/admin/usage?" + params.toString(), { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar analytics de uso");
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar analytics de uso");
    } finally { setLoading(false); }
  }, [days, organizationId]);

  useEffect(() => { void load(); }, [load]);

  const users = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.users || []).filter(item => !needle || [item.email,item.displayName,item.jobTitle,item.organizationName].some(v => v?.toLowerCase().includes(needle)));
  }, [data, query]);

  const s = data?.summary;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><span>ADMINISTRACIÓN DEL SAAS</span><h1>Uso de la plataforma</h1><p>Actividad autenticada por usuario: sesiones, tiempo activo, módulos, consultas IA y descargas.</p></div>
      <div className={styles.headerActions}><button onClick={() => void load()} disabled={loading}>↻ Actualizar</button><Link href="/">Volver al dashboard</Link></div>
    </header>

    {error && <div className={styles.error}>{error}</div>}
    <section className={styles.filters}>
      <select value={days} onChange={e => setDays(e.target.value)}><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="365">Último año</option></select>
      <select value={organizationId} onChange={e => setOrganizationId(e.target.value)}><option value="">Todos los clientes</option>{(data?.organizations || []).map(o => <option key={o.organizationId} value={o.organizationId}>{o.organizationName}</option>)}</select>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar usuario, email o empresa…" />
    </section>

    <section className={styles.metrics}>
      <article><span>Usuarios activos</span><strong>{number.format(s?.users || 0)}</strong><small>{s?.activeNow || 0} activos ahora</small></article>
      <article><span>Sesiones</span><strong>{number.format(s?.sessions || 0)}</strong><small>{minutes(s?.avgSessionMinutes)} promedio</small></article>
      <article><span>Tiempo activo</span><strong>{minutes(s?.activeMinutes)}</strong><small>pestaña visible + interacción</small></article>
      <article><span>Page views</span><strong>{number.format(s?.pageViews || 0)}</strong><small>navegación interna</small></article>
      <article><span>Consultas IA</span><strong>{number.format(s?.chatQueries || 0)}</strong><small>sin guardar el texto</small></article>
      <article><span>Descargas</span><strong>{number.format(s?.downloads || 0)}</strong><small>archivos exportados</small></article>
    </section>

    <section className={styles.orgGrid}>
      {(data?.organizations || []).slice(0,8).map(org => <button key={org.organizationId} className={organizationId === org.organizationId ? styles.orgActive : ""} onClick={() => setOrganizationId(organizationId === org.organizationId ? "" : org.organizationId)}>
        <div><strong>{org.organizationName}</strong><span>{org.plan} · {org.status}</span></div>
        <b>{minutes(org.activeMinutes)}</b>
        <small>{org.users} usuario(s) · {org.sessions} sesiones · últ. {fmtDate(org.lastSeenAt)}</small>
      </button>)}
    </section>

    <div className={styles.tabs}><button className={tab==="users"?styles.active:""} onClick={() => setTab("users")}>Usuarios</button><button className={tab==="events"?styles.active:""} onClick={() => setTab("events")}>Actividad reciente</button></div>

    {loading && !data ? <div className={styles.loading}>Cargando actividad…</div> : null}

    {tab === "users" && <section className={styles.card}>
      <div className={styles.cardTitle}><div><strong>Uso por usuario</strong><span>{users.length} usuarios visibles</span></div><small>Tiempo activo calculado por heartbeat cada 30 segundos.</small></div>
      <div className={styles.tableWrap}><table><thead><tr><th>Usuario / cliente</th><th>Última actividad</th><th>Sesiones</th><th>Tiempo activo</th><th>Promedio</th><th>Page views</th><th>IA</th><th>Descargas</th><th>Módulos principales</th></tr></thead><tbody>
        {users.map(user => <tr key={user.userId+"-"+user.organizationId}>
          <td><strong>{user.displayName || user.email}</strong><span>{user.organizationName}</span><small>{user.displayName ? user.email : user.jobTitle || ""}</small></td>
          <td><strong className={user.activeNow ? styles.online : ""}>{user.activeNow ? "● Activo ahora" : fmtDate(user.lastSeenAt)}</strong><small>desde {fmtDate(user.firstSeenAt)}</small></td>
          <td><strong>{user.sessions}</strong></td><td><strong>{minutes(user.activeMinutes)}</strong></td><td>{minutes(user.avgSessionMinutes)}</td>
          <td>{user.pageViews}</td><td>{user.chatQueries}</td><td>{user.downloads}</td>
          <td><div className={styles.chips}>{(user.topModules || []).map(m => <span key={m.module}>{m.module} <b>{m.events}</b></span>)}</div></td>
        </tr>)}
        {!users.length && <tr><td colSpan={9} className={styles.empty}>Todavía no hay actividad para este filtro.</td></tr>}
      </tbody></table></div>
    </section>}

    {tab === "events" && <section className={styles.card}>
      <div className={styles.cardTitle}><div><strong>Log de actividad</strong><span>Últimos {Math.min(500, data?.recentEvents.length || 0)} eventos</span></div><small>No se almacena texto escrito en chats, búsquedas o formularios.</small></div>
      <div className={styles.eventList}>{(data?.recentEvents || []).map(event => <article key={event.id}>
        <time>{fmtDate(event.createdAt)}</time>
        <div><strong>{event.displayName || event.email}</strong><span>{event.organizationName}</span></div>
        <b>{eventLabel(event.eventName)}</b>
        <span>{event.module || "platform"}</span>
        <small>{typeof event.metadata?.label === "string" ? String(event.metadata.label) : event.path || "—"}</small>
      </article>)}
      {!data?.recentEvents.length && <div className={styles.empty}>Todavía no hay eventos registrados.</div>}</div>
    </section>}
  </main>;
}
