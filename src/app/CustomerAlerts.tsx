"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./CustomerAlerts.module.css";

type AlertEvent = {
  id: number;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  payload?: Record<string, unknown> | null;
  status: string;
  detected_at: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
};
type AlertRule = {
  id: string;
  name: string;
  alert_type: string;
  severity: string;
  condition?: Record<string, unknown> | null;
  enabled: boolean;
  cooldown_minutes: number;
  last_triggered_at?: string | null;
};
type Payload = {
  organizationId?: string;
  canManage?: boolean;
  events?: AlertEvent[];
  unread?: number;
  rules?: AlertRule[];
  error?: string;
};

const TYPE_LABELS: Record<string, string> = {
  price_change: "Cambios de precio",
  promotion: "Promociones",
  stock_out: "Quiebres de stock",
  assortment_change: "Cambios de surtido",
  new_product: "Productos nuevos",
};
const SEVERITY_LABELS: Record<string, string> = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };

function date(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
function threshold(rule: AlertRule) { return Number(rule.condition?.threshold ?? (rule.alert_type === "price_change" ? 10 : 1)); }

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "No fue posible completar la operación.");
  return payload;
}

export default function CustomerAlerts() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"feed" | "rules">("feed");
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "acknowledged" | "resolved">("all");

  const load = useCallback(async () => {
    const payload = await api<Payload>("/api/alerts");
    setData(payload);
  }, []);

  useEffect(() => {
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "No fue posible cargar las alertas.")).finally(() => setLoading(false));
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load().catch(() => {}); }, 60_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const events = useMemo(() => (data?.events ?? []).filter((event) => statusFilter === "all" || event.status === statusFilter), [data?.events, statusFilter]);
  const activeRules = (data?.rules ?? []).filter((rule) => rule.enabled).length;

  async function run(action: () => Promise<unknown>, success: string) {
    setWorking(true); setError(""); setMessage("");
    try { await action(); setMessage(success); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible completar la operación."); }
    finally { setWorking(false); }
  }

  function updateEvent(event: AlertEvent, status: "acknowledged" | "resolved" | "suppressed") {
    void run(() => api("/api/alerts", { method: "POST", body: JSON.stringify({ action: "eventStatus", eventId: event.id, status }) }), status === "resolved" ? "Señal resuelta." : "Señal actualizada.");
  }

  function saveRule(event: FormEvent<HTMLFormElement>, existing?: AlertRule) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const alertType = String(form.get("alertType") ?? existing?.alert_type ?? "price_change");
    const name = String(form.get("name") ?? existing?.name ?? "").trim();
    const severity = String(form.get("severity") ?? existing?.severity ?? "medium");
    const value = Number(form.get("threshold") ?? threshold(existing!));
    const enabled = form.get("enabled") === "on";
    void run(() => api("/api/alerts", { method: "POST", body: JSON.stringify({ action: "rule", id: existing?.id, alertType, name, severity, threshold: value, enabled }) }), existing ? "Regla actualizada." : "Regla creada.");
  }

  function deleteRule(rule: AlertRule) {
    if (!confirm(`¿Eliminar la regla “${rule.name}”?`)) return;
    void run(() => api(`/api/alerts?id=${encodeURIComponent(rule.id)}`, { method: "DELETE" }), "Regla eliminada.");
  }

  if (loading) return <section className={styles.state}>Cargando centro de alertas…</section>;
  if (!data) return <section className={styles.state}>{error || "No fue posible cargar el centro de alertas."}</section>;

  return <section className={styles.shell}>
    <div className={styles.kpis}>
      <article><span>Sin revisar</span><strong>{data.unread ?? 0}</strong><small>eventos nuevos</small></article>
      <article><span>Reglas activas</span><strong>{activeRules}</strong><small>evaluadas cada 15 min</small></article>
      <article><span>Historial</span><strong>{data.events?.length ?? 0}</strong><small>eventos recientes</small></article>
    </div>

    <div className={styles.tabs}><button className={tab === "feed" ? styles.activeTab : ""} onClick={() => setTab("feed")}>Feed de señales {data.unread ? <b>{data.unread}</b> : null}</button><button className={tab === "rules" ? styles.activeTab : ""} onClick={() => setTab("rules")}>Reglas</button></div>
    {message && <div className={styles.success}>{message}</div>}
    {error && <div className={styles.error}>{error}</div>}

    {tab === "feed" && <div className={styles.feedWrap}>
      <div className={styles.feedToolbar}><div><strong>Alertas persistentes</strong><span>Generadas por reglas del alcance de tu organización.</span></div><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Todos los estados</option><option value="new">Nuevas</option><option value="acknowledged">Reconocidas</option><option value="resolved">Resueltas</option></select></div>
      <div className={styles.feed}>{events.length ? events.map((event) => <article key={event.id} className={`${styles.event} ${styles[`severity_${event.severity}`] ?? ""}`}>
        <div className={styles.eventIcon}>{event.alert_type === "price_change" ? "$" : event.alert_type === "promotion" ? "%" : event.alert_type === "stock_out" ? "!" : "◎"}</div>
        <div className={styles.eventCopy}><div><span>{TYPE_LABELS[event.alert_type] ?? event.alert_type}</span><b>{SEVERITY_LABELS[event.severity] ?? event.severity}</b><em className={styles[`status_${event.status}`] ?? ""}>{event.status === "new" ? "Nueva" : event.status === "acknowledged" ? "Reconocida" : event.status === "resolved" ? "Resuelta" : event.status}</em></div><h3>{event.title}</h3><p>{event.message}</p><small>Detectada {date(event.detected_at)}</small></div>
        <div className={styles.eventActions}>{event.status === "new" && <button onClick={() => updateEvent(event, "acknowledged")} disabled={working}>Reconocer</button>}{event.status !== "resolved" && <button onClick={() => updateEvent(event, "resolved")} disabled={working}>Resolver</button>}</div>
      </article>) : <div className={styles.empty}><strong>No hay señales en este estado.</strong><p>Las reglas activas se evalúan automáticamente cada 15 minutos. Cuando una condición se cumpla, aparecerá aquí y quedará guardada.</p></div>}</div>
    </div>}

    {tab === "rules" && <div className={styles.rulesLayout}>
      <div className={styles.rulesList}>{(data.rules ?? []).map((rule) => <article className={styles.rule} key={rule.id}>
        <header><div><span>{TYPE_LABELS[rule.alert_type] ?? rule.alert_type}</span><h3>{rule.name}</h3></div><b className={rule.enabled ? styles.ruleOn : styles.ruleOff}>{rule.enabled ? "Activa" : "Pausada"}</b></header>
        <form onSubmit={(event) => saveRule(event, rule)}>
          <input type="hidden" name="alertType" value={rule.alert_type}/>
          <label>Nombre<input name="name" defaultValue={rule.name} disabled={!data.canManage}/></label>
          <label>Umbral<input name="threshold" type="number" min="1" max={rule.alert_type === "price_change" ? 100 : 10000} defaultValue={threshold(rule)} disabled={!data.canManage}/><small>{rule.alert_type === "price_change" ? "% de variación" : "eventos por ventana"}</small></label>
          <label>Prioridad<select name="severity" defaultValue={rule.severity} disabled={!data.canManage}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label>
          <label className={styles.check}><input name="enabled" type="checkbox" defaultChecked={rule.enabled} disabled={!data.canManage}/><span>Regla activa</span></label>
          {data.canManage && <div className={styles.ruleActions}><button disabled={working}>Guardar</button><button type="button" onClick={() => deleteRule(rule)} disabled={working}>Eliminar</button></div>}
        </form>
        <footer>Última activación: {date(rule.last_triggered_at)} · canal: dentro de la plataforma</footer>
      </article>)}</div>
      {data.canManage && <form className={styles.createRule} onSubmit={(event) => saveRule(event)}>
        <span>NUEVA REGLA</span><h3>Agrega una señal a tu monitoreo</h3><label>Tipo<select name="alertType" defaultValue="price_change"><option value="price_change">Cambio de precio</option><option value="promotion">Movimiento promocional</option><option value="stock_out">Quiebre de stock</option><option value="assortment_change">Cambio de surtido</option><option value="new_product">Producto nuevo</option></select></label><label>Nombre<input name="name" required minLength={2} placeholder="Ej. Alzas de precio relevantes"/></label><label>Umbral<input name="threshold" type="number" defaultValue={10} min={1}/></label><label>Prioridad<select name="severity" defaultValue="medium"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label><label className={styles.check}><input name="enabled" type="checkbox" defaultChecked/><span>Activar al crear</span></label><button disabled={working}>{working ? "Guardando…" : "Crear regla"}</button><small>Las alertas de esta versión se entregan dentro de MGP Super Precios. El correo transaccional se habilita por separado.</small>
      </form>}
    </div>}
  </section>;
}
