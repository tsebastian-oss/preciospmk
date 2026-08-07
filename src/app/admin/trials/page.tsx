"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./trials.module.css";

type Summary = { total: number; new7d: number; activated: number; qualified: number; proposals: number; won: number; lost: number; expiring3d: number; pipelineMrr: number; wonMrr: number };
type Plan = { code: string; name: string; monthlyPrice: number | null; annualMonthlyPrice: number | null; setupFee: number; trialDays: number; users: number | null; retailerLimit: number | null; exportsPerMonth: number | null; description: string; modules: string[] };
type Registration = {
  userId: string; email: string; fullName: string | null; phone: string | null; company: string; jobTitle: string | null; industrySlug: string | null;
  organizationId: string | null; organizationName: string | null; organizationStatus: string | null; organizationPlan: string | null;
  status: string; commercialStage: string; intendedPlan: string | null; billingCycle: string | null; quotedMrr: number | null;
  trialStartedAt: string; trialExpiresAt: string; emailConfirmedAt: string | null; activatedAt: string | null; lastSeenAt: string | null;
  lastContactedAt: string | null; nextFollowupAt: string | null; convertedAt: string | null; lostAt: string | null; lostReason: string | null;
  salesNotes: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; createdAt: string; leadScore: number; trialDaysRemaining: number;
};
type Policy = { trialDays: number; maxExtensionDays: number; monthlyPremium: string; annualPrepayDiscountPct: number; quoteValidityDays: number; rules: string[]; addOns: { name: string; price: string }[] };
type Payload = { summary: Summary; plans: Plan[]; registrations: Registration[]; policy: Policy; error?: string };

type Draft = { commercialStage: string; intendedPlan: string; billingCycle: string; quotedMrr: string; nextFollowupAt: string; salesNotes: string; lostReason: string };

const STAGES = [
  ["new", "Nuevo"], ["activated", "Activado"], ["qualified", "Calificado"], ["proposal", "Propuesta"], ["negotiation", "Negociación"], ["won", "Ganado"], ["lost", "Perdido"],
] as const;
const stageLabel = (stage: string) => STAGES.find(([value]) => value === stage)?.[1] ?? stage;
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("es-CL", { dateStyle: "short" });
const dateTime = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" });
function fmtMoney(value: number | null | undefined) { return value ? money.format(value) : "—"; }
function fmtDate(value: string | null | undefined) { return value ? date.format(new Date(value)) : "—"; }
function fmtDateTime(value: string | null | undefined) { return value ? dateTime.format(new Date(value)) : "—"; }
function inputDateTime(value: string | null | undefined) { if (!value) return ""; const d = new Date(value); const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
function makeDraft(item: Registration): Draft { return { commercialStage: item.commercialStage, intendedPlan: item.intendedPlan ?? "", billingCycle: item.billingCycle ?? "annual", quotedMrr: item.quotedMrr ? String(item.quotedMrr) : "", nextFollowupAt: inputDateTime(item.nextFollowupAt), salesNotes: item.salesNotes ?? "", lostReason: item.lostReason ?? "" }; }

export default function TrialsAdminPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [tab, setTab] = useState<"pipeline" | "policy">("pipeline");
  const [selected, setSelected] = useState<Registration | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/trials", { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar los registros");
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar los registros");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es-CL");
    return (data?.registrations ?? []).filter((item) => {
      if (stage !== "all" && item.commercialStage !== stage) return false;
      if (!needle) return true;
      return [item.company, item.fullName, item.email, item.jobTitle, item.industrySlug].some((value) => value?.toLocaleLowerCase("es-CL").includes(needle));
    });
  }, [data, query, stage]);

  function open(item: Registration) { setSelected(item); setDraft(makeDraft(item)); setError(""); }

  async function update(patch: Record<string, unknown>, close = false) {
    if (!selected) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/admin/trials", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: selected.userId, patch }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No fue posible actualizar la oportunidad");
      await load();
      if (close) { setSelected(null); setDraft(null); }
      else {
        const refreshed = data?.registrations.find((item) => item.userId === selected.userId);
        if (refreshed) { setSelected(refreshed); setDraft(makeDraft(refreshed)); }
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible actualizar la oportunidad"); }
    finally { setSaving(false); }
  }

  async function save() {
    if (!draft) return;
    await update({
      commercialStage: draft.commercialStage,
      intendedPlan: draft.intendedPlan || null,
      billingCycle: draft.billingCycle || null,
      quotedMrr: draft.quotedMrr || null,
      nextFollowupAt: draft.nextFollowupAt ? new Date(draft.nextFollowupAt).toISOString() : null,
      salesNotes: draft.salesNotes || null,
      lostReason: draft.commercialStage === "lost" ? draft.lostReason || null : null,
    }, true);
  }

  const s = data?.summary;
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><span>ADMINISTRACIÓN DEL SAAS</span><h1>Trials & Commercial CRM</h1><p>Registro, activación y conversión de cuentas creadas desde la web comercial.</p></div>
      <div className={styles.headerActions}><button onClick={() => void load()} disabled={loading}>↻ Actualizar</button><Link href="/">Volver al dashboard</Link></div>
    </header>

    <div className={styles.tabs}><button className={tab === "pipeline" ? styles.activeTab : ""} onClick={() => setTab("pipeline")}>Pipeline de trials</button><button className={tab === "policy" ? styles.activeTab : ""} onClick={() => setTab("policy")}>Política comercial</button></div>

    {error && <div className={styles.error}>{error}</div>}
    {loading && !data ? <div className={styles.loading}>Cargando pipeline comercial…</div> : null}

    {tab === "pipeline" && data && <>
      <section className={styles.metrics}>
        <article><span>Registros</span><strong>{s?.total ?? 0}</strong><small>{s?.new7d ?? 0} últimos 7 días</small></article>
        <article><span>Activados</span><strong>{s?.activated ?? 0}</strong><small>completaron onboarding</small></article>
        <article><span>Calificados</span><strong>{s?.qualified ?? 0}</strong><small>oportunidades activas</small></article>
        <article><span>Propuestas</span><strong>{s?.proposals ?? 0}</strong><small>propuesta / negociación</small></article>
        <article><span>Pipeline MRR</span><strong>{fmtMoney(s?.pipelineMrr)}</strong><small>MRR cotizado abierto</small></article>
        <article><span>MRR ganado</span><strong>{fmtMoney(s?.wonMrr)}</strong><small>{s?.won ?? 0} clientes ganados</small></article>
      </section>

      <section className={styles.toolbar}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar empresa, nombre, email o cargo…" />
        <select value={stage} onChange={(e) => setStage(e.target.value)}><option value="all">Todas las etapas</option>{STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <div className={styles.warning}>{s?.expiring3d ?? 0} trial(s) vencen en ≤ 3 días</div>
      </section>

      <section className={styles.tableCard}>
        <div className={styles.tableTitle}><div><strong>Pipeline comercial</strong><span>{filtered.length} registros visibles</span></div><small>Score 0–100 según confirmación, onboarding y calidad de datos del prospecto.</small></div>
        <div className={styles.tableWrap}><table><thead><tr><th>Empresa / contacto</th><th>Etapa</th><th>Score</th><th>Trial</th><th>Plan</th><th>MRR</th><th>Próxima gestión</th><th></th></tr></thead><tbody>
          {filtered.map((item) => <tr key={item.userId}>
            <td><strong>{item.company}</strong><span>{item.fullName || item.email}</span><small>{item.jobTitle || item.email}</small></td>
            <td><span className={`${styles.stage} ${styles[`stage_${item.commercialStage}`]}`}>{stageLabel(item.commercialStage)}</span><small>{item.status}</small></td>
            <td><div className={styles.score}><b>{item.leadScore}</b><i><em style={{ width: `${item.leadScore}%` }} /></i></div></td>
            <td><strong>{item.trialDaysRemaining} días</strong><small>vence {fmtDate(item.trialExpiresAt)}</small></td>
            <td><strong>{item.intendedPlan ? data.plans.find((p) => p.code === item.intendedPlan)?.name ?? item.intendedPlan : "Sin definir"}</strong><small>{item.billingCycle === "monthly" ? "Mensual" : item.billingCycle === "annual" ? "Anual" : "—"}</small></td>
            <td><strong>{fmtMoney(item.quotedMrr)}</strong><small>{item.commercialStage === "won" ? "ganado" : "cotizado"}</small></td>
            <td><strong>{fmtDateTime(item.nextFollowupAt)}</strong><small>últ. contacto {fmtDate(item.lastContactedAt)}</small></td>
            <td><button className={styles.openButton} onClick={() => open(item)}>Gestionar</button></td>
          </tr>)}
          {!filtered.length && <tr><td colSpan={8} className={styles.empty}>Todavía no hay registros para este filtro.</td></tr>}
        </tbody></table></div>
      </section>
    </>}

    {tab === "policy" && data && <section className={styles.policy}>
      <div className={styles.policyIntro}><span>POLÍTICA COMERCIAL V1</span><h2>Monetización simple, con urgencia de trial y expansión por valor.</h2><p>El precio anual es el objetivo comercial. El plan mensual compra flexibilidad; Enterprise monetiza complejidad, integración y acompañamiento.</p></div>
      <div className={styles.planGrid}>{data.plans.map((plan) => <article key={plan.code} className={plan.code === "business" ? styles.recommended : ""}>{plan.code === "business" && <b className={styles.tag}>PLAN OBJETIVO</b>}<h3>{plan.name}</h3><p>{plan.description}</p><div className={styles.planPrice}>{plan.annualMonthlyPrice ? fmtMoney(plan.annualMonthlyPrice) : "A medida"}<small> + IVA / mes · compromiso anual</small></div>{plan.monthlyPrice && <div className={styles.monthly}>Mensual flexible: <strong>{fmtMoney(plan.monthlyPrice)}</strong></div>}<ul><li>{plan.users ?? "A medida"} usuarios incluidos</li><li>{plan.retailerLimit ?? "A medida"} retailers</li><li>{plan.exportsPerMonth ?? "A medida"} exportaciones / mes</li><li>{plan.setupFee ? `Onboarding desde ${fmtMoney(plan.setupFee)}` : "Onboarding incluido"}</li></ul></article>)}</div>
      <div className={styles.policyGrid}><article><h3>Reglas comerciales</h3><ul>{data.policy.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul></article><article><h3>Add-ons de expansión</h3><div className={styles.addons}>{data.policy.addOns.map((add) => <div key={add.name}><strong>{add.name}</strong><span>{add.price}</span></div>)}</div></article></div>
      <div className={styles.funnel}><div><span>01</span><strong>Registro</strong><small>Cuenta trial creada</small></div><b>→</b><div><span>02</span><strong>Activación</strong><small>Configura industria</small></div><b>→</b><div><span>03</span><strong>Calificación</strong><small>Dolor + uso + presupuesto</small></div><b>→</b><div><span>04</span><strong>Propuesta</strong><small>Plan + MRR + vigencia</small></div><b>→</b><div><span>05</span><strong>Ganado</strong><small>Plan se activa</small></div></div>
    </section>}

    {selected && draft && <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) { setSelected(null); setDraft(null); } }}><aside className={styles.drawer}>
      <div className={styles.drawerHead}><div><span>OPORTUNIDAD</span><h2>{selected.company}</h2><p>{selected.fullName || selected.email} · {selected.jobTitle || "Sin cargo"}</p></div><button onClick={() => { setSelected(null); setDraft(null); }}>×</button></div>
      <div className={styles.drawerFacts}><div><span>Score</span><strong>{selected.leadScore}/100</strong></div><div><span>Trial</span><strong>{selected.trialDaysRemaining} días</strong></div><div><span>Último uso</span><strong>{fmtDate(selected.lastSeenAt)}</strong></div></div>
      <div className={styles.contactBox}><a href={`mailto:${selected.email}`}>{selected.email}</a>{selected.phone && <a href={`tel:${selected.phone}`}>{selected.phone}</a>}<span>Registrado {fmtDateTime(selected.createdAt)}</span></div>
      <div className={styles.drawerForm}>
        <label>Etapa<select value={draft.commercialStage} onChange={(e) => setDraft({ ...draft, commercialStage: e.target.value })}>{STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Plan<select value={draft.intendedPlan} onChange={(e) => { const plan = data?.plans.find((p) => p.code === e.target.value); setDraft({ ...draft, intendedPlan: e.target.value, quotedMrr: draft.quotedMrr || String(plan?.annualMonthlyPrice ?? "") }); }}><option value="">Sin definir</option>{data?.plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select></label>
        <label>Ciclo<select value={draft.billingCycle} onChange={(e) => setDraft({ ...draft, billingCycle: e.target.value })}><option value="annual">Anual</option><option value="monthly">Mensual</option></select></label>
        <label>MRR cotizado CLP<input type="number" min={0} step={10000} value={draft.quotedMrr} onChange={(e) => setDraft({ ...draft, quotedMrr: e.target.value })} placeholder="1490000" /></label>
        <label>Próxima gestión<input type="datetime-local" value={draft.nextFollowupAt} onChange={(e) => setDraft({ ...draft, nextFollowupAt: e.target.value })} /></label>
        {draft.commercialStage === "lost" && <label>Motivo de pérdida<input value={draft.lostReason} onChange={(e) => setDraft({ ...draft, lostReason: e.target.value })} placeholder="Precio, timing, competencia…" /></label>}
        <label className={styles.full}>Notas comerciales<textarea rows={5} value={draft.salesNotes} onChange={(e) => setDraft({ ...draft, salesNotes: e.target.value })} placeholder="Dolor, decisor, presupuesto, próximos pasos…" /></label>
      </div>
      <div className={styles.quickActions}><button onClick={() => void update({ markContacted: true })} disabled={saving}>✓ Marcar contactado</button><button onClick={() => void update({ extendTrialDays: 7 })} disabled={saving}>+7 días de trial</button></div>
      <div className={styles.drawerFooter}><button className={styles.secondary} onClick={() => { setSelected(null); setDraft(null); }}>Cancelar</button><button className={styles.primary} onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : draft.commercialStage === "won" ? "Guardar y activar plan" : "Guardar cambios"}</button></div>
    </aside></div>}
  </main>;
}
