"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "../ai/admin-ai.module.css";

type Status = {
  provider: "resend" | "brevo";
  fromEmail: string | null;
  fromName: string;
  enabled: boolean;
  configured: boolean;
  updatedAt?: string;
};

export default function AdminNotificationsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [provider, setProvider] = useState<"resend" | "brevo">("resend");
  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("MGP Intelligence");
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/notifications", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as Status & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "No se pudo cargar la configuración");
        setStatus(data);
        setProvider(data.provider ?? "resend");
        setFromEmail(data.fromEmail ?? "");
        setFromName(data.fromName ?? "MGP Intelligence");
        setEnabled(Boolean(data.enabled));
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, apiKey, fromEmail, fromName, enabled }),
      });
      const data = await response.json() as Status & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo guardar la configuración");
      setStatus(data);
      setApiKey("");
      setMessage("Proveedor de notificaciones guardado en Vault.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <span>ADMINISTRACIÓN DEL SAAS</span>
        <h1>Notificaciones enterprise</h1>
        <p>Configura el proveedor transaccional que entregará alertas por correo. La API key se cifra en Supabase Vault y solo la utiliza el dispatcher interno.</p>
      </div>
      <Link href="/enterprise">Volver a Enterprise Control</Link>
    </header>

    <section className={styles.card}>
      <div className={styles.status}>
        <div><span>Proveedor</span><strong>{status?.provider === "brevo" ? "Brevo" : "Resend"}</strong></div>
        <div><span>API configurada</span><strong>{status?.configured ? "Sí" : "No"}</strong></div>
        <div><span>Entrega</span><strong>{status?.enabled ? "Activa" : "Desactivada"}</strong></div>
      </div>

      <form onSubmit={save}>
        <label>Proveedor<select value={provider} onChange={(event) => setProvider(event.target.value as "resend" | "brevo")}><option value="resend">Resend</option><option value="brevo">Brevo</option></select></label>
        <label>API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status?.configured ? "Dejar vacío para mantener la clave actual" : provider === "brevo" ? "xkeysib-..." : "re_..."} autoComplete="new-password" /></label>
        <label>Email remitente<input type="email" value={fromEmail} onChange={(event) => setFromEmail(event.target.value)} placeholder="alertas@tudominio.cl" /></label>
        <label>Nombre remitente<input value={fromName} onChange={(event) => setFromName(event.target.value)} /></label>
        <label className={styles.toggle}><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>Activar entrega automática de alertas por correo</span></label>
        <button disabled={loading}>{loading ? "Guardando..." : "Guardar configuración"}</button>
      </form>
      {message && <p className={styles.message}>{message}</p>}
    </section>
  </main>;
}
