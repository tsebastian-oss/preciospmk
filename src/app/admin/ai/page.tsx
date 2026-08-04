"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./admin-ai.module.css";

type Status = { provider: string; model: string; enabled: boolean; configured: boolean; updated_at?: string };

export default function AdminAiPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-5-mini");
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/ai", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No se pudo cargar la configuración");
        setStatus(data);
        setModel(data.model ?? "gpt-5-mini");
        setEnabled(Boolean(data.enabled));
      })
      .catch((error) => setMessage(error.message))
      .finally(() => setLoading(false));
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, model, enabled }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo guardar");
      setStatus(data);
      setApiKey("");
      setMessage("Configuración guardada correctamente.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span>ADMINISTRACIÓN DEL SAAS</span>
          <h1>Configuración de IA</h1>
          <p>La API key se almacena cifrada en Supabase Vault y nunca se entrega al navegador ni a los clientes.</p>
        </div>
        <Link href="/">Volver al dashboard</Link>
      </header>

      <section className={styles.card}>
        <div className={styles.status}>
          <div><span>Proveedor</span><strong>OpenAI</strong></div>
          <div><span>API configurada</span><strong>{status?.configured ? "Sí" : "No"}</strong></div>
          <div><span>Estado</span><strong>{status?.enabled ? "Activa" : "Desactivada"}</strong></div>
        </div>

        <form onSubmit={save}>
          <label>
            API key de OpenAI
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status?.configured ? "Dejar vacío para mantener la clave actual" : "sk-..."} autoComplete="new-password" />
          </label>
          <label>
            Modelo
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="gpt-5-mini">gpt-5-mini</option>
              <option value="gpt-5">gpt-5</option>
              <option value="gpt-4.1-mini">gpt-4.1-mini</option>
            </select>
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            <span>Activar análisis generativo para los clientes</span>
          </label>
          <button disabled={loading}>{loading ? "Guardando..." : "Guardar configuración"}</button>
        </form>
        {message && <p className={styles.message}>{message}</p>}
      </section>
    </main>
  );
}
