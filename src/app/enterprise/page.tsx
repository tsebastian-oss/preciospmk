"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./enterprise.module.css";

type Tab = "overview" | "organizations" | "members" | "quality" | "alerts" | "audit" | "matches" | "reports" | "settings";
type Organization = {
  id: string;
  name: string;
  slug: string;
  type: "platform" | "retailer" | "brand";
  status: string;
  plan: string;
  role: string;
  settings?: Record<string, unknown> | null;
  scopes?: Record<string, unknown> | null;
};
type ContextData = {
  user: { id: string; email: string; displayName: string; jobTitle?: string | null; lastOrganizationId?: string | null };
  isSaasAdmin: boolean;
  organizations: Organization[];
};
type AdminOverview = {
  summary: {
    organizations: number;
    activeOrganizations: number;
    members: number;
    pendingInvitations: number;
    enabledAlerts: number;
    pendingMatchReviews: number;
    queuedReports: number;
  };
  organizations: Array<{
    id: string; name: string; slug: string; type: string; status: string; plan: string; members: number; alerts: number; createdAt: string;
  }>;
  recentAudit: AuditEntry[];
  latestDataQuality?: QualitySnapshot | null;
};
type Member = { userId: string; email: string; displayName: string; jobTitle?: string | null; role: string; status: string; joinedAt: string };
type Invitation = { id: string; email: string; role: string; status: string; expires_at: string; created_at: string };
type AlertRule = { id: string; name: string; alert_type: string; severity: string; enabled: boolean; condition: Record<string, unknown>; recipients: string[]; created_at: string };
type ReportJob = { id: string; report_type: string; format: string; status: string; requested_at: string; result_url?: string | null; error_message?: string | null };
type MatchReview = { id: string; status: string; proposed_relationship?: string | null; final_relationship?: string | null; confidence?: number | null; created_at: string; notes?: string | null };
type OrganizationDetail = {
  organization: { id: string; name: string; slug: string; organization_type: string; status: string; plan: string; settings: Record<string, unknown> };
  settings: { default_world: string; locale: string; timezone: string; refresh_frequency: string; ai_enabled: boolean; alerts_enabled: boolean; data_retention_months: number; report_branding: Record<string, unknown> };
  scopes: { retailers: string[]; brands: string[]; competitors: string[]; categories: string[]; modules: string[]; limits: Record<string, number> };
  members: Member[];
  invitations: Invitation[];
  alerts: AlertRule[];
  reports: ReportJob[];
  matchReviews: MatchReview[];
};
type QualitySnapshot = {
  id: number;
  capture_completion_pct: number | string;
  valid_price_pct: number | string;
  stock_known_pct: number | string;
  image_coverage_pct: number | string;
  match_coverage_pct: number | string;
  failed_tasks: number;
  stale_products: number;
  products_total: number;
  metrics: Record<string, unknown>;
  captured_at: string;
};
type QualityData = { latest: QualitySnapshot | null; history: QualitySnapshot[]; targets: Record<string, number> };
type AuditEntry = { id: number; actor_user_id?: string | null; action: string; entity_type: string; entity_id?: string | null; old_values?: Record<string, unknown> | null; new_values?: Record<string, unknown> | null; metadata?: Record<string, unknown>; created_at: string };

const tabs: Array<{ id: Tab; label: string; description: string }> = [
  { id: "overview", label: "Control Center", description: "Salud general y riesgos" },
  { id: "organizations", label: "Empresas", description: "Planes y tenants" },
  { id: "members", label: "Usuarios & Roles", description: "Accesos y permisos" },
  { id: "quality", label: "Data Quality", description: "Cobertura y confiabilidad" },
  { id: "alerts", label: "Alertas", description: "Reglas y destinatarios" },
  { id: "audit", label: "Audit Log", description: "Trazabilidad completa" },
  { id: "matches", label: "Match Review", description: "Gobierno de comparables" },
  { id: "reports", label: "Report Center", description: "Entregables ejecutivos" },
  { id: "settings", label: "Configuración", description: "Alcance y políticas" },
];

const number = new Intl.NumberFormat("es-CL");
const date = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });
function n(input: unknown) { const parsed = Number(input ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function pct(input: unknown) { return `${n(input).toFixed(1)}%`; }
function fmtDate(input?: string | null) { return input ? date.format(new Date(input)) : "—"; }
function splitCsv(input: FormDataEntryValue | null) { return String(input ?? "").split(",").map((item) => item.trim()).filter(Boolean); }

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "No fue posible completar la operación");
  return payload;
}

function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" | "warning" | "risk" }) {
  return <article className={`${styles.metric} ${styles[tone]}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function QualityBar({ label, value, target }: { label: string; value: number; target: number }) {
  const tone = value >= target ? styles.barGood : value >= target - 8 ? styles.barWarning : styles.barRisk;
  return <div className={styles.qualityRow}>
    <div><strong>{label}</strong><span>Objetivo ≥ {target}%</span></div>
    <div className={styles.progress}><i className={tone} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    <b>{value.toFixed(1)}%</b>
  </div>;
}

export default function EnterprisePage() {
  const [context, setContext] = useState<ContextData | null>(null);
  const [admin, setAdmin] = useState<AdminOverview | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [detail, setDetail] = useState<OrganizationDetail | null>(null);
  const [quality, setQuality] = useState<QualityData | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadContext = useCallback(async () => {
    const data = await api<ContextData>("/api/enterprise/context");
    setContext(data);
    const stored = window.localStorage.getItem("mgp-enterprise-organization");
    const resolved = data.organizations.find((item) => item.id === stored)?.id
      ?? data.user.lastOrganizationId
      ?? data.organizations[0]?.id
      ?? "";
    setOrganizationId(resolved);
    if (data.isSaasAdmin) setAdmin(await api<AdminOverview>("/api/enterprise/admin"));
  }, []);

  const loadOrganization = useCallback(async (id: string) => {
    if (!id) return;
    const [org, dq, logs] = await Promise.all([
      api<OrganizationDetail>(`/api/enterprise/organization?organizationId=${encodeURIComponent(id)}`),
      api<QualityData>(`/api/enterprise/data-quality?organizationId=${encodeURIComponent(id)}`),
      api<AuditEntry[]>(`/api/enterprise/audit?organizationId=${encodeURIComponent(id)}&limit=80`).catch(() => []),
    ]);
    setDetail(org);
    setQuality(dq);
    setAudit(logs);
  }, []);

  useEffect(() => {
    void loadContext().catch((cause) => setError(cause instanceof Error ? cause.message : "Error cargando Enterprise Control")).finally(() => setLoading(false));
  }, [loadContext]);

  useEffect(() => {
    if (!organizationId) return;
    window.localStorage.setItem("mgp-enterprise-organization", organizationId);
    setLoading(true);
    void loadOrganization(organizationId).catch((cause) => setError(cause instanceof Error ? cause.message : "Error cargando la empresa")).finally(() => setLoading(false));
  }, [organizationId, loadOrganization]);

  const activeOrganization = context?.organizations.find((item) => item.id === organizationId) ?? null;
  const canManage = context?.isSaasAdmin || ["owner", "admin"].includes(activeOrganization?.role ?? "");
  const q = quality?.latest;
  const riskCount = useMemo(() => {
    if (!q) return 0;
    return [n(q.capture_completion_pct) < 98, n(q.valid_price_pct) < 97, n(q.stock_known_pct) < 98, n(q.match_coverage_pct) < 90, q.stale_products > 0].filter(Boolean).length;
  }, [q]);

  async function run(action: () => Promise<unknown>, success: string) {
    setWorking(true); setError(""); setMessage("");
    try {
      await action();
      setMessage(success);
      await loadContext();
      if (organizationId) await loadOrganization(organizationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error inesperado");
    } finally { setWorking(false); }
  }

  function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() => api("/api/enterprise/admin", { method: "POST", body: JSON.stringify({
      action: "createOrganization",
      name: form.get("name"), slug: form.get("slug"), organizationType: form.get("type"), plan: form.get("plan"), ownerEmail: form.get("ownerEmail"),
    }) }), "Empresa creada y aislada correctamente.");
    event.currentTarget.reset();
  }

  function inviteMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() => api("/api/enterprise/organization", { method: "POST", body: JSON.stringify({
      action: "inviteMember", organizationId, email: form.get("email"), role: form.get("role"),
    }) }), "Invitación registrada. Si el usuario ya existe, el acceso quedó activo.");
    event.currentTarget.reset();
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() => api("/api/enterprise/organization", { method: "POST", body: JSON.stringify({
      action: "updateConfiguration", organizationId,
      settings: {
        default_world: form.get("defaultWorld"), timezone: form.get("timezone"), refresh_frequency: form.get("frequency"),
        ai_enabled: form.get("aiEnabled") === "on", alerts_enabled: form.get("alertsEnabled") === "on",
        data_retention_months: Number(form.get("retention")),
      },
      scopes: {
        retailers: splitCsv(form.get("retailers")), brands: splitCsv(form.get("brands")), competitors: splitCsv(form.get("competitors")), categories: splitCsv(form.get("categories")),
      },
    }) }), "Configuración guardada y auditada.");
  }

  function createAlert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const threshold = Number(form.get("threshold"));
    void run(() => api("/api/enterprise/alerts", { method: "POST", body: JSON.stringify({
      organizationId, name: form.get("name"), alertType: form.get("alertType"), severity: form.get("severity"),
      condition: { threshold, operator: form.get("operator") }, recipients: splitCsv(form.get("recipients")), channels: ["email"], enabled: true,
    }) }), "Regla de alerta creada.");
    event.currentTarget.reset();
  }

  function requestReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() => api("/api/enterprise/reports", { method: "POST", body: JSON.stringify({
      organizationId, reportType: form.get("reportType"), format: form.get("format"), parameters: { requestedFrom: "enterprise_control" },
    }) }), "Reporte agregado a la cola.");
  }

  if (loading && !context) return <main className={styles.loadingPage}><span /><strong>Inicializando gobierno enterprise…</strong></main>;
  if (!context) return <main className={styles.loadingPage}><strong>{error || "No fue posible cargar la consola enterprise."}</strong><a href="/">Volver</a></main>;

  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <a className={styles.brand} href="/"><span>M</span><div><strong>MGP Intelligence</strong><small>Enterprise Control</small></div></a>
      <div className={styles.tenantPicker}>
        <label>Organización activa</label>
        <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
          {context.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <div><span>{activeOrganization?.type ?? "—"}</span><b>{activeOrganization?.role ?? "—"}</b></div>
      </div>
      <nav>{tabs.filter((item) => context.isSaasAdmin || item.id !== "organizations").map((item) => <button key={item.id} className={tab === item.id ? styles.active : ""} onClick={() => setTab(item.id)}><span>{item.label}</span><small>{item.description}</small></button>)}</nav>
      <div className={styles.identity}><span>{context.user.displayName}</span><small>{context.user.email}</small><a href="/api/auth/logout">Cerrar sesión</a></div>
    </aside>

    <main className={styles.main}>
      <header className={styles.header}>
        <div><span>ENTERPRISE GOVERNANCE · SECURE TENANT</span><h1>{tabs.find((item) => item.id === tab)?.label}</h1><p>{activeOrganization?.name} · {activeOrganization?.plan} · aislamiento RLS activo</p></div>
        <div className={styles.headerStatus}><i /><div><span>Gobierno activo</span><strong>{context.isSaasAdmin ? "SaaS Administrator" : `${activeOrganization?.role}`}</strong></div></div>
      </header>

      {message && <div className={styles.success}>{message}<button onClick={() => setMessage("")}>×</button></div>}
      {error && <div className={styles.error}>{error}<button onClick={() => setError("")}>×</button></div>}

      {tab === "overview" && <section className={styles.content}>
        <div className={styles.metrics}>
          <Metric label="Empresas administradas" value={number.format(admin?.summary.organizations ?? context.organizations.length)} detail={`${admin?.summary.activeOrganizations ?? context.organizations.filter((item) => item.status === "active").length} activas`} tone="good" />
          <Metric label="Usuarios activos" value={number.format(admin?.summary.members ?? detail?.members.length ?? 0)} detail={`${admin?.summary.pendingInvitations ?? detail?.invitations.filter((item) => item.status === "pending").length ?? 0} invitaciones pendientes`} />
          <Metric label="Riesgos de datos" value={number.format(riskCount)} detail="Indicadores bajo objetivo" tone={riskCount ? "risk" : "good"} />
          <Metric label="Alertas activas" value={number.format(admin?.summary.enabledAlerts ?? detail?.alerts.filter((item) => item.enabled).length ?? 0)} detail="Reglas automáticas" tone="warning" />
        </div>
        <div className={styles.heroGrid}>
          <article className={styles.governanceCard}><span>ENTERPRISE READINESS</span><h2>La operación ya es trazable por empresa, usuario y decisión.</h2><p>Los permisos se aplican en PostgreSQL mediante Row-Level Security. Las configuraciones, roles, alertas, matches y reportes generan evidencia en el audit log.</p><div className={styles.pillRow}><b>RLS activo</b><b>Roles granulares</b><b>Audit log</b><b>Data Quality</b><b>IA administrada</b></div></article>
          <article className={styles.riskCard}><span>PRIORIDAD OPERACIONAL</span><strong>{riskCount ? "Mejorar calidad antes del SLA" : "Indicadores dentro de objetivo"}</strong><p>{q ? `Captura ${pct(q.capture_completion_pct)} · precios válidos ${pct(q.valid_price_pct)} · matching ${pct(q.match_coverage_pct)}.` : "Aún no existe una medición de calidad."}</p><button disabled={working} onClick={() => void run(() => api("/api/enterprise/data-quality", { method: "POST", body: JSON.stringify({ organizationId: null }) }), "Calidad de datos actualizada.")}>Actualizar diagnóstico</button></article>
        </div>
        <div className={styles.dualGrid}>
          <article className={styles.panel}><div className={styles.panelHead}><div><span>CONTROL FRAMEWORK</span><h3>Controles implementados</h3></div></div><div className={styles.controlList}>{[
            ["Aislamiento multiempresa", "Aplicado en base de datos mediante RLS"], ["Roles y permisos", "Owner, admin, analyst, executive y viewer"], ["Trazabilidad", "Registro automático de cambios críticos"], ["Gobierno del matching", "Aprobación y rechazo auditables"], ["Data Quality Center", "Objetivos y evolución de confiabilidad"], ["Report Center", "Cola gobernada de entregables"],
          ].map(([title, detailText]) => <div key={title}><i /><div><strong>{title}</strong><span>{detailText}</span></div><b>ACTIVO</b></div>)}</div></article>
          <article className={styles.panel}><div className={styles.panelHead}><div><span>RECENT ACTIVITY</span><h3>Últimos eventos</h3></div><button onClick={() => setTab("audit")}>Ver audit log</button></div><div className={styles.activityList}>{(audit.length ? audit : admin?.recentAudit ?? []).slice(0, 8).map((item) => <div key={item.id}><span>{item.action}</span><strong>{item.entity_type}</strong><small>{fmtDate(item.created_at)}</small></div>)}</div></article>
        </div>
      </section>}

      {tab === "organizations" && context.isSaasAdmin && <section className={styles.content}>
        <div className={styles.splitLayout}>
          <article className={styles.panel}><div className={styles.panelHead}><div><span>TENANT DIRECTORY</span><h3>Empresas y planes</h3></div></div><div className={styles.orgList}>{admin?.organizations.map((item) => <button key={item.id} onClick={() => setOrganizationId(item.id)} className={item.id === organizationId ? styles.selectedOrg : ""}><div><strong>{item.name}</strong><span>{item.type} · {item.slug}</span></div><div><b>{item.plan}</b><span>{item.members} usuarios · {item.alerts} alertas</span></div><i className={styles[item.status]}>{item.status}</i></button>)}</div></article>
          <article className={styles.panel}><div className={styles.panelHead}><div><span>NEW TENANT</span><h3>Crear empresa aislada</h3></div></div><form className={styles.form} onSubmit={createOrganization}><label>Nombre<input name="name" required placeholder="Ej. Unilever Chile" /></label><label>Slug<input name="slug" required placeholder="unilever-chile" /></label><div className={styles.formGrid}><label>Tipo<select name="type" defaultValue="brand"><option value="brand">Marca</option><option value="retailer">Retailer</option><option value="platform">Plataforma</option></select></label><label>Plan<select name="plan" defaultValue="brand_intelligence"><option value="pilot">Pilot</option><option value="brand_monitor">Brand Monitor</option><option value="brand_intelligence">Brand Intelligence</option><option value="retail_pilot">Retail Pilot</option><option value="retail_intelligence">Retail Intelligence</option><option value="enterprise">Enterprise</option></select></label></div><label>Email del owner<input name="ownerEmail" type="email" placeholder="admin@cliente.cl" /></label><button disabled={working}>Crear tenant</button></form></article>
        </div>
      </section>}

      {tab === "members" && <section className={styles.content}>
        <div className={styles.splitLayout}>
          <article className={styles.panel}><div className={styles.panelHead}><div><span>ACCESS CONTROL</span><h3>Usuarios y roles</h3></div><b>{detail?.members.length ?? 0} activos</b></div><div className={styles.tableWrap}><table><thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Ingreso</th></tr></thead><tbody>{detail?.members.map((member) => <tr key={member.userId}><td><strong>{member.displayName}</strong><small>{member.email}</small></td><td>{canManage ? <select value={member.role} onChange={(event) => void run(() => api("/api/enterprise/organization", { method: "POST", body: JSON.stringify({ action: "updateMember", organizationId, userId: member.userId, role: event.target.value }) }), "Rol actualizado.")}><option>owner</option><option>admin</option><option>analyst</option><option>executive</option><option>viewer</option></select> : member.role}</td><td><span className={`${styles.status} ${styles[member.status]}`}>{member.status}</span></td><td>{fmtDate(member.joinedAt)}</td></tr>)}</tbody></table></div></article>
          <div className={styles.stack}>{canManage && <article className={styles.panel}><div className={styles.panelHead}><div><span>INVITE</span><h3>Agregar usuario</h3></div></div><form className={styles.form} onSubmit={inviteMember}><label>Email<input name="email" type="email" required /></label><label>Rol<select name="role" defaultValue="analyst"><option>admin</option><option>analyst</option><option>executive</option><option>viewer</option></select></label><button disabled={working}>Registrar invitación</button></form></article>}<article className={styles.panel}><div className={styles.panelHead}><div><span>PENDING</span><h3>Invitaciones</h3></div></div><div className={styles.simpleList}>{detail?.invitations.map((invite) => <div key={invite.id}><div><strong>{invite.email}</strong><span>{invite.role} · vence {fmtDate(invite.expires_at)}</span></div><b className={styles[invite.status]}>{invite.status}</b></div>)}</div></article></div>
        </div>
      </section>}

      {tab === "quality" && <section className={styles.content}>
        <div className={styles.metrics}><Metric label="Productos medidos" value={number.format(q?.products_total ?? 0)} detail={`Captura ${fmtDate(q?.captured_at)}`} /><Metric label="Tareas fallidas" value={number.format(q?.failed_tasks ?? 0)} detail="Última corrida" tone={q?.failed_tasks ? "risk" : "good"} /><Metric label="Productos stale" value={number.format(q?.stale_products ?? 0)} detail="Más de 48 horas" tone={q?.stale_products ? "warning" : "good"} /><Metric label="Estado de calidad" value={riskCount ? "Requiere acción" : "Saludable"} detail={`${riskCount} métricas bajo objetivo`} tone={riskCount ? "risk" : "good"} /></div>
        <article className={styles.panel}><div className={styles.panelHead}><div><span>DATA QUALITY SCORECARD</span><h3>Calidad medible y verificable</h3></div><button disabled={working} onClick={() => void run(() => api("/api/enterprise/data-quality", { method: "POST", body: JSON.stringify({ organizationId: null }) }), "Snapshot actualizado.")}>Capturar ahora</button></div><div className={styles.qualityList}>{q && <><QualityBar label="Captura completada" value={n(q.capture_completion_pct)} target={98} /><QualityBar label="Productos con precio válido" value={n(q.valid_price_pct)} target={97} /><QualityBar label="Stock conocido" value={n(q.stock_known_pct)} target={98} /><QualityBar label="Cobertura de imágenes" value={n(q.image_coverage_pct)} target={90} /><QualityBar label="Cobertura de matching" value={n(q.match_coverage_pct)} target={90} /></>}</div></article>
        <article className={styles.panel}><div className={styles.panelHead}><div><span>HISTORY</span><h3>Evolución de snapshots</h3></div></div><div className={styles.tableWrap}><table><thead><tr><th>Fecha</th><th>Captura</th><th>Precio válido</th><th>Stock</th><th>Imágenes</th><th>Matching</th><th>Errores</th></tr></thead><tbody>{quality?.history.map((item) => <tr key={item.id}><td>{fmtDate(item.captured_at)}</td><td>{pct(item.capture_completion_pct)}</td><td>{pct(item.valid_price_pct)}</td><td>{pct(item.stock_known_pct)}</td><td>{pct(item.image_coverage_pct)}</td><td>{pct(item.match_coverage_pct)}</td><td>{item.failed_tasks}</td></tr>)}</tbody></table></div></article>
      </section>}

      {tab === "alerts" && <section className={styles.content}><div className={styles.splitLayout}><article className={styles.panel}><div className={styles.panelHead}><div><span>ALERT RULES</span><h3>Monitoreo automatizado</h3></div></div><div className={styles.simpleList}>{detail?.alerts.map((alert) => <div key={alert.id}><div><strong>{alert.name}</strong><span>{alert.alert_type} · {alert.severity} · {alert.recipients?.join(", ") || "Sin destinatarios"}</span></div><b className={alert.enabled ? styles.activeRule : styles.inactiveRule}>{alert.enabled ? "ACTIVA" : "PAUSADA"}</b></div>)}</div></article>{canManage && <article className={styles.panel}><div className={styles.panelHead}><div><span>NEW RULE</span><h3>Crear alerta</h3></div></div><form className={styles.form} onSubmit={createAlert}><label>Nombre<input name="name" required placeholder="KVI sobre mercado" /></label><div className={styles.formGrid}><label>Tipo<select name="alertType"><option value="price_change">Cambio de precio</option><option value="price_index">Índice de precio</option><option value="promotion">Promoción</option><option value="stock_out">Quiebre de stock</option><option value="assortment_change">Cambio de surtido</option><option value="new_product">Producto nuevo</option><option value="data_quality">Calidad de datos</option><option value="match_review">Match pendiente</option></select></label><label>Severidad<select name="severity"><option>low</option><option>medium</option><option>high</option><option>critical</option></select></label></div><div className={styles.formGrid}><label>Operador<select name="operator"><option value="gte">Mayor o igual</option><option value="lte">Menor o igual</option><option value="eq">Igual</option></select></label><label>Umbral<input name="threshold" type="number" defaultValue="10" /></label></div><label>Destinatarios<input name="recipients" placeholder="correo1@empresa.cl, correo2@empresa.cl" /></label><button disabled={working}>Crear regla</button></form></article>}</div></section>}

      {tab === "audit" && <section className={styles.content}><article className={styles.panel}><div className={styles.panelHead}><div><span>IMMUTABLE ACTIVITY</span><h3>Audit log de la organización</h3></div><b>{audit.length} eventos visibles</b></div><div className={styles.tableWrap}><table><thead><tr><th>Fecha</th><th>Acción</th><th>Entidad</th><th>ID</th><th>Actor</th></tr></thead><tbody>{audit.map((item) => <tr key={item.id}><td>{fmtDate(item.created_at)}</td><td><span className={styles.auditAction}>{item.action}</span></td><td>{item.entity_type}</td><td><code>{item.entity_id || "—"}</code></td><td><code>{item.actor_user_id?.slice(0, 8) || "system"}</code></td></tr>)}</tbody></table></div></article></section>}

      {tab === "matches" && <section className={styles.content}><div className={styles.metrics}><Metric label="Pendientes" value={number.format(detail?.matchReviews.filter((item) => item.status === "pending").length ?? 0)} detail="Requieren validación" tone="warning" /><Metric label="Aprobados" value={number.format(detail?.matchReviews.filter((item) => item.status === "approved").length ?? 0)} detail="Relaciones gobernadas" tone="good" /><Metric label="Rechazados" value={number.format(detail?.matchReviews.filter((item) => item.status === "rejected").length ?? 0)} detail="Falsos comparables evitados" /><Metric label="SLA revisión" value="24 h" detail="Objetivo operacional" /></div><article className={styles.panel}><div className={styles.panelHead}><div><span>MATCH GOVERNANCE</span><h3>Decisiones humanas auditables</h3></div></div>{detail?.matchReviews.length ? <div className={styles.tableWrap}><table><thead><tr><th>Fecha</th><th>Estado</th><th>Propuesta</th><th>Final</th><th>Confianza</th><th>Notas</th></tr></thead><tbody>{detail.matchReviews.map((item) => <tr key={item.id}><td>{fmtDate(item.created_at)}</td><td>{item.status}</td><td>{item.proposed_relationship || "—"}</td><td>{item.final_relationship || "—"}</td><td>{item.confidence ? `${item.confidence}%` : "—"}</td><td>{item.notes || "—"}</td></tr>)}</tbody></table></div> : <div className={styles.empty}>No existen matches enviados a revisión. El flujo ya está preparado para recibir casos dudosos desde Competitive Analysis.</div>}</article></section>}

      {tab === "reports" && <section className={styles.content}><div className={styles.splitLayout}><article className={styles.panel}><div className={styles.panelHead}><div><span>REPORT QUEUE</span><h3>Entregables empresariales</h3></div></div><div className={styles.simpleList}>{detail?.reports.map((report) => <div key={report.id}><div><strong>{report.report_type}</strong><span>{report.format.toUpperCase()} · solicitado {fmtDate(report.requested_at)}</span></div><b className={styles[report.status]}>{report.status}</b></div>)}</div></article><article className={styles.panel}><div className={styles.panelHead}><div><span>REQUEST REPORT</span><h3>Generar entregable</h3></div></div><form className={styles.form} onSubmit={requestReport}><label>Tipo<select name="reportType"><option value="executive">Executive report</option><option value="brand_scorecard">Brand scorecard</option><option value="retailer_scorecard">Retailer scorecard</option><option value="pricing">Pricing</option><option value="promotions">Promotions</option><option value="availability">Availability</option><option value="assortment">Assortment</option><option value="data_quality">Data quality</option><option value="audit">Audit</option></select></label><label>Formato<select name="format"><option value="pdf">PDF</option><option value="xlsx">Excel</option><option value="csv">CSV</option><option value="pptx">PowerPoint</option></select></label><button disabled={working}>Agregar a la cola</button><small>La cola y su trazabilidad ya están activas. Los generadores de archivos se conectarán por tipo de reporte.</small></form></article></div></section>}

      {tab === "settings" && <section className={styles.content}><div className={styles.splitLayout}><article className={styles.panel}><div className={styles.panelHead}><div><span>TENANT CONFIGURATION</span><h3>Políticas operacionales</h3></div></div>{detail && <form key={organizationId} className={styles.form} onSubmit={saveSettings}><div className={styles.formGrid}><label>Mundo inicial<select name="defaultWorld" defaultValue={detail.settings.default_world}><option value="retailer">Retailer</option><option value="brand">Marcas</option></select></label><label>Frecuencia<select name="frequency" defaultValue={detail.settings.refresh_frequency}><option value="daily">Diaria</option><option value="twice_daily">Dos veces al día</option><option value="hourly">Cada hora</option><option value="manual">Manual</option></select></label></div><label>Zona horaria<input name="timezone" defaultValue={detail.settings.timezone} /></label><label>Retención de datos (meses)<input name="retention" type="number" min="3" max="120" defaultValue={detail.settings.data_retention_months} /></label><div className={styles.checks}><label><input name="aiEnabled" type="checkbox" defaultChecked={detail.settings.ai_enabled} /> IA habilitada</label><label><input name="alertsEnabled" type="checkbox" defaultChecked={detail.settings.alerts_enabled} /> Alertas habilitadas</label></div><label>Retailers<input name="retailers" defaultValue={detail.scopes.retailers.join(", ")} /></label><label>Marcas monitoreadas<input name="brands" defaultValue={detail.scopes.brands.join(", ")} /></label><label>Competidores<input name="competitors" defaultValue={detail.scopes.competitors.join(", ")} /></label><label>Categorías<input name="categories" defaultValue={detail.scopes.categories.join(", ")} /></label><button disabled={!canManage || working}>{canManage ? "Guardar configuración" : "Solo lectura"}</button></form>}</article><article className={styles.panel}><div className={styles.panelHead}><div><span>SECURITY POSTURE</span><h3>Controles de seguridad</h3></div></div><div className={styles.securityList}><div><i /><strong>Row-Level Security</strong><span>El usuario solo accede a organizaciones donde tiene membresía.</span></div><div><i /><strong>Cookies HttpOnly</strong><span>La sesión no se expone al JavaScript del navegador.</span></div><div><i /><strong>Secretos en Vault</strong><span>La API key de IA permanece fuera del cliente y del repositorio.</span></div><div><i /><strong>Audit log automático</strong><span>Cambios críticos registrados directamente por PostgreSQL.</span></div><div><i /><strong>Headers defensivos</strong><span>Protección de framing, MIME sniffing y permisos del navegador.</span></div></div></article></div></section>}
    </main>
  </div>;
}
