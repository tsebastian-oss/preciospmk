"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./UsageAnalyticsPanel.module.css";

type Summary = {
  users: number;
  organizations: number;
  sessions: number;
  activeMinutes: number;
  avgSessionMinutes: number;
  pageViews: number;
  events: number;
  chatQueries: number;
  downloads: number;
  activeNow: number;
  lastActivity: string | null;
};

type Organization = {
  organizationId: string;
  organizationName: string;
  status: string;
  plan: string;
  users: number;
  sessions: number;
  activeMinutes: number;
  pageViews: number;
  lastSeenAt: string;
};

type ModuleUsage = { module: string; events: number };

type UserUsage = {
  userId: string;
  email: string;
  displayName: string | null;
  jobTitle: string | null;
  organizationId: string;
  organizationName: string;
  sessions: number;
  activeMinutes: number;
  avgSessionMinutes: number;
  pageViews: number;
  events: number;
  chatQueries: number;
  downloads: number;
  firstSeenAt: string;
  lastSeenAt: string;
  activeNow: boolean;
  topModules: ModuleUsage[];
};

type EventItem = {
  id: number;
  createdAt: string;
  eventName: string;
  module: string | null;
  path: string | null;
  durationMs: number;
  metadata: Record<string, unknown>;
  userId: string;
  email: string;
  displayName: string | null;
  organizationId: string;
  organizationName: string;
};

type Payload = {
  days: number;
  summary: Summary;
  organizations: Organization[];
  users: UserUsage[];
  recentEvents: EventItem[];
  error?: string;
};

const dt = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" });
const integer = new Intl.NumberFormat("es-CL");

function fmtDate(value: string | null | undefined) {
  return value ? dt.format(new Date(value)) : "—";
}

function minutes(value: number | null | undefined) {
  const n = Number(value || 0);
  if (n < 60) return `${Math.round(n)} min`;
  return `${(n / 60).toLocaleString("es-CL", { maximumFractionDigits: 1 })} h`;
}

function eventLabel(name: string) {
  const labels: Record<string, string> = {
    session_start: "Inicio de sesión",
    page_view: "Vista de página",
    heartbeat: "Actividad",
    session_end: "Fin de sesión",
    click: "Click",
    module_view: "Módulo",
    chat_submit: "Consulta IA",
    download: "Descarga",
    filter_change: "Filtro",
  };
  return labels[name] || name;
}

export default function UsageAnalyticsPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [days, setDays] = useState("30");
  const [organizationId, setOrganizationId] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"users" | "events">("users");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ days });
      if (organizationId) params.set("organizationId", organizationId);
      const response = await fetch("/api/admin/usage?" + params.toString(), { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar analytics de uso");
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar analytics de uso");
    } finally {
      setLoading(false);
    }
  }, [days, organizationId]);

  useEffect(() => { void load(); }, [load]);

  const users = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.users || []).filter((item) => !needle || [item.email, item.displayName, item.jobTitle, item.organizationName].some((value) => value?.toLowerCase().includes(needle)));
  }, [data, query]);

  const summary = data?.summary;

  return <section className={styles.shell}>
    <div className={styles.toolbar}>
      <div>
        <select value={days} onChange={(event) => setDays(event.target.value)}>
          <option value="7">Últimos 7 días</option>
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="365">Último año</option>
        </select>
        <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
          <option value="">Todos los clientes</option>
          {(data?.organizations || []).map((item) => <option key={item.organizationId} value={item.organizationId}>{item.organizationName}</option>)}
        </select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar usuario, email o empresa…" />
      </div>
      <button onClick={() => void load()} disabled={loading}>↻ Actualizar</button>
    </div>

    {error && <div className={styles.error}>{error}</div>}

    <section className={styles.metrics}>
      <article><span>Usuarios activos</span><strong>{integer.format(summary?.users || 0)}</strong><small>{summary?.activeNow || 0} activos ahora</small></article>
      <article><span>Sesiones</span><strong>{integer.format(summary?.sessions || 0)}</strong><small>{minutes(summary?.avgSessionMinutes)} promedio</small></article>
      <article><span>Tiempo activo</span><strong>{minutes(summary?.activeMinutes)}</strong><small>uso real estimado</small></article>
      <article><span>Page views</span><strong>{integer.format(summary?.pageViews || 0)}</strong><small>navegación interna</small></article>
      <article><span>Consultas IA</span><strong>{integer.format(summary?.chatQueries || 0)}</strong><small>sin guardar texto</small></article>
      <article><span>Descargas</span><strong>{integer.format(summary?.downloads || 0)}</strong><small>archivos exportados</small></article>
    </section>

    <section className={styles.clientGrid}>
      {(data?.organizations || []).slice(0, 8).map((item) => <button key={item.organizationId} className={organizationId === item.organizationId ? styles.clientActive : ""} onClick={() => setOrganizationId(organizationId === item.organizationId ? "" : item.organizationId)}>
        <div><strong>{item.organizationName}</strong><span>{item.plan} · {item.status}</span></div>
        <b>{minutes(item.activeMinutes)}</b>
        <small>{item.users} usuario(s) · {item.sessions} sesiones</small>
        <small>Última actividad {fmtDate(item.lastSeenAt)}</small>
      </button>)}
    </section>

    <div className={styles.tabs}>
      <button className={tab === "users" ? styles.activeTab : ""} onClick={() => setTab("users")}>Usuarios</button>
      <button className={tab === "events" ? styles.activeTab : ""} onClick={() => setTab("events")}>Actividad reciente</button>
    </div>

    {loading && !data ? <div className={styles.loading}>Cargando actividad…</div> : null}

    {tab === "users" && <article className={styles.card}>
      <header className={styles.cardHeader}><div><strong>Uso por usuario</strong><span>{users.length} usuarios visibles</span></div><small>Tiempo activo medido por heartbeat cada 30 segundos.</small></header>
      <div className={styles.tableWrap}><table>
        <thead><tr><th>Usuario / cliente</th><th>Última actividad</th><th>Sesiones</th><th>Tiempo activo</th><th>Promedio</th><th>Page views</th><th>IA</th><th>Descargas</th><th>Módulos principales</th></tr></thead>
        <tbody>
          {users.map((user) => <tr key={user.userId + "-" + user.organizationId}>
            <td><strong>{user.displayName || user.email}</strong><span>{user.organizationName}</span><small>{user.displayName ? user.email : user.jobTitle || ""}</small></td>
            <td><strong className={user.activeNow ? styles.online : ""}>{user.activeNow ? "● Activo ahora" : fmtDate(user.lastSeenAt)}</strong><small>desde {fmtDate(user.firstSeenAt)}</small></td>
            <td><strong>{user.sessions}</strong></td>
            <td><strong>{minutes(user.activeMinutes)}</strong></td>
            <td>{minutes(user.avgSessionMinutes)}</td>
            <td>{user.pageViews}</td>
            <td>{user.chatQueries}</td>
            <td>{user.downloads}</td>
            <td><div className={styles.chips}>{(user.topModules || []).map((module) => <span key={module.module}>{module.module}<b>{module.events}</b></span>)}</div></td>
          </tr>)}
          {!users.length && <tr><td colSpan={9} className={styles.empty}>Todavía no hay actividad para este filtro.</td></tr>}
        </tbody>
      </table></div>
    </article>}

    {tab === "events" && <article className={styles.card}>
      <header className={styles.cardHeader}><div><strong>Log de actividad</strong><span>Últimos {Math.min(500, data?.recentEvents.length || 0)} eventos</span></div><small>No se almacena texto escrito en chats, búsquedas o formularios.</small></header>
      <div className={styles.eventList}>
        {(data?.recentEvents || []).map((event) => <div key={event.id}>
          <time>{fmtDate(event.createdAt)}</time>
          <span><strong>{event.displayName || event.email}</strong><small>{event.organizationName}</small></span>
          <b>{eventLabel(event.eventName)}</b>
          <em>{event.module || "platform"}</em>
          <small>{typeof event.metadata?.label === "string" ? String(event.metadata.label) : event.path || "—"}</small>
        </div>)}
        {!data?.recentEvents.length && <div className={styles.empty}>Todavía no hay eventos registrados.</div>}
      </div>
    </article>}
  </section>;
}
