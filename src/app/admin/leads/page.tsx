"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./leads.module.css";

type Lead = {
  id: string; name: string; email: string; phone?: string | null; company: string; role?: string | null; industry?: string | null;
  message: string; preferredDate?: string | null; preferredTime?: string | null; source?: string | null; status: string; createdAt: string;
};
type Payload = { summary?: { total?: number; new?: number; last7d?: number }; leads?: Lead[]; error?: string };

const STATUS: Record<string, string> = { new: "Nuevo", contacted: "Contactado", qualified: "Calificado", closed: "Cerrado" };

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options, headers: { "content-type": "application/json", ...(options?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "No fue posible completar la operación.");
  return payload;
}

export default function AdminLeadsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  const load = useCallback(async () => {
    setData(await api<Payload>("/api/admin/leads"));
  }, []);

  useEffect(() => {
    void load().catch((caught) => setError(caught instanceof Error ? caught.message : "No fue posible cargar los leads."));
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load().catch(() => {}); }, 30_000);
    return () => window.clearInterval(interval);
  }, [load]);

  const leads = useMemo(() => (data?.leads ?? []).filter((lead) => {
    const haystack = `${lead.name} ${lead.email} ${lead.company} ${lead.role ?? ""} ${lead.industry ?? ""}`.toLocaleLowerCase("es-CL");
    return (status === "all" || lead.status === status) && (!query.trim() || haystack.includes(query.trim().toLocaleLowerCase("es-CL")));
  }), [data?.leads, query, status]);

  async function update(lead: Lead, next: string) {
    setWorking(lead.id); setError("");
    try {
      await api("/api/admin/leads", { method: "POST", body: JSON.stringify({ id: lead.id, status: next }) });
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No fue posible actualizar el lead."); }
    finally { setWorking(""); }
  }

  if (!data && !error) return <main className={styles.page}><div className={styles.state}>Cargando leads comerciales…</div></main>;
  if (!data) return <main className={styles.page}><div className={styles.state}>{error}<Link href="/">Volver</Link></div></main>;

  return <main className={styles.page}><div className={styles.shell}>
    <header className={styles.top}><Link href="/" className={styles.brand}><span>M</span><div><strong>MGP Super Precios</strong><small>Lead Inbox</small></div></Link><div><Link href="/admin/trials">Trials / CRM</Link><Link href="/">Plataforma</Link></div></header>
    <section className={styles.hero}><span>SAAS ADMIN · LEADS</span><h1>Solicitudes comerciales</h1><p>Todos los formularios públicos quedan centralizados aquí. La bandeja se actualiza automáticamente cada 30 segundos.</p></section>
    <section className={styles.metrics}><article><span>Total</span><strong>{data.summary?.total ?? 0}</strong><small>leads registrados</small></article><article><span>Nuevos</span><strong>{data.summary?.new ?? 0}</strong><small>requieren contacto</small></article><article><span>Últimos 7 días</span><strong>{data.summary?.last7d ?? 0}</strong><small>actividad reciente</small></article></section>
    {error && <div className={styles.error}>{error}</div>}
    <section className={styles.toolbar}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa, nombre, correo…"/><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Todos los estados</option><option value="new">Nuevos</option><option value="contacted">Contactados</option><option value="qualified">Calificados</option><option value="closed">Cerrados</option></select><span>{leads.length} resultados</span></section>
    <section className={styles.list}>{leads.length ? leads.map((lead) => <article key={lead.id} className={styles.card}>
      <div className={styles.main}><header><div><span className={`${styles.badge} ${styles[`status_${lead.status}`] ?? ""}`}>{STATUS[lead.status] ?? lead.status}</span><small>{new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(lead.createdAt))}</small></div><h2>{lead.company}</h2><p><strong>{lead.name}</strong>{lead.role ? ` · ${lead.role}` : ""}{lead.industry ? ` · ${lead.industry}` : ""}</p></header><blockquote>{lead.message}</blockquote>{(lead.preferredDate || lead.preferredTime) && <div className={styles.preference}>Demo preferida: <strong>{lead.preferredDate || "sin fecha"} {lead.preferredTime || ""}</strong></div>}</div>
      <aside><a href={`mailto:${lead.email}`}>{lead.email}</a>{lead.phone && <a href={`tel:${lead.phone}`}>{lead.phone}</a>}<select value={lead.status} onChange={(event) => void update(lead, event.target.value)} disabled={working === lead.id}><option value="new">Nuevo</option><option value="contacted">Contactado</option><option value="qualified">Calificado</option><option value="closed">Cerrado</option></select>{lead.phone && <a className={styles.whatsapp} href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">Abrir WhatsApp</a>}</aside>
    </article>) : <div className={styles.empty}>No hay leads con estos filtros.</div>}</section>
  </div></main>;
}
