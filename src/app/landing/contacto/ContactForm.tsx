"use client";

import { FormEvent, useMemo, useState } from "react";
import styles from "../marketing.module.css";

type FormState = {
  name: string;
  email: string;
  phone: string;
  company: string;
  role: string;
  industry: string;
  message: string;
  preferredDate: string;
  preferredTime: string;
  website: string;
};

const INITIAL: FormState = { name: "", email: "", phone: "", company: "", role: "", industry: "", message: "", preferredDate: "", preferredTime: "", website: "" };

export default function ContactForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [startedAt] = useState(() => Date.now());
  const minDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  function field<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, startedAt }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "No fue posible enviar tu solicitud");
      setStatus("Gracias. Tu solicitud quedó registrada y te contactaremos usando los datos que nos indicaste.");
      setForm(INITIAL);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "No fue posible enviar tu solicitud");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={styles.formGrid} onSubmit={submit}>
      <label>Nombre completo *<input value={form.name} onChange={(e) => field("name", e.target.value)} required maxLength={120} autoComplete="name" placeholder="Tu nombre" /></label>
      <label>Correo electrónico *<input type="email" value={form.email} onChange={(e) => field("email", e.target.value)} required maxLength={180} autoComplete="email" placeholder="nombre@empresa.cl" /></label>
      <label>Teléfono<input value={form.phone} onChange={(e) => field("phone", e.target.value)} maxLength={40} autoComplete="tel" placeholder="+56 9..." /></label>
      <label>Empresa *<input value={form.company} onChange={(e) => field("company", e.target.value)} required maxLength={140} autoComplete="organization" placeholder="Empresa" /></label>
      <label>Cargo<input value={form.role} onChange={(e) => field("role", e.target.value)} maxLength={120} autoComplete="organization-title" placeholder="Gerente Comercial, Pricing, Marketing..." /></label>
      <label>Industria<select value={form.industry} onChange={(e) => field("industry", e.target.value)}><option value="">Selecciona</option><option>Supermercados</option><option>Farmacias</option><option>Multitiendas</option><option>Consumo masivo</option><option>Automotriz</option><option>Servicios</option><option>Otra</option></select></label>
      <label>Fecha preferida para demo<input type="date" min={minDate} value={form.preferredDate} onChange={(e) => field("preferredDate", e.target.value)} /></label>
      <label>Horario preferido<select value={form.preferredTime} onChange={(e) => field("preferredTime", e.target.value)}><option value="">Sin preferencia</option><option>09:00 - 11:00</option><option>11:00 - 13:00</option><option>14:00 - 16:00</option><option>16:00 - 18:00</option></select></label>
      <label className={styles.fullField}>Tu mensaje *<textarea value={form.message} onChange={(e) => field("message", e.target.value)} required maxLength={2000} placeholder="Cuéntanos qué quieres monitorear, qué retailers te interesan o qué problema quieres resolver." /></label>
      <label style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }} aria-hidden="true">Sitio web<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => field("website", e.target.value)} /></label>
      {status && <div className={styles.formStatus}>{status}</div>}
      <button className={styles.submitButton} type="submit" disabled={loading}>{loading ? "Enviando…" : "Enviar solicitud"}</button>
    </form>
  );
}
