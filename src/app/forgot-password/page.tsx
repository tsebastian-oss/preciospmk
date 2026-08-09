"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "../login/login.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(payload.error || "No fue posible procesar la solicitud.");
      setMessage(payload.message || "Revisa tu correo para continuar.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible procesar la solicitud.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <Link href="/landing" className={styles.brand}>
        <span>M</span>
        <div><strong>MGP Super Precios</strong><small>Price Intelligence Platform</small></div>
      </Link>
      <section className={styles.card}>
        <span className={styles.eyebrow}>RECUPERAR ACCESO</span>
        <h1>Restablece tu contraseña.</h1>
        <p>Ingresa el correo asociado a tu cuenta. Si existe, te enviaremos un enlace seguro de recuperación.</p>
        <form onSubmit={submit}>
          <label>
            Correo electrónico
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          {error && <div className={styles.error}>{error}</div>}
          {message && <div style={{ padding: "12px 14px", border: "1px solid rgba(189,243,75,.25)", background: "rgba(189,243,75,.08)", borderRadius: 10, color: "#dfffa2", fontSize: 13, lineHeight: 1.5 }}>{message}</div>}
          <button type="submit" disabled={loading}>{loading ? "Enviando…" : "Enviar enlace"}</button>
        </form>
        <div style={{ marginTop: 20, textAlign: "center", fontSize: 13 }}>
          <Link href="/login" style={{ color: "#bdf34b", fontWeight: 800 }}>← Volver al inicio de sesión</Link>
        </div>
      </section>
    </main>
  );
}
