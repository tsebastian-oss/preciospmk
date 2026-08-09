"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import styles from "./login.module.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No fue posible iniciar sesión");
      window.location.href = "/onboarding";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error de autenticación");
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
        <span className={styles.eyebrow}>ACCESO CLIENTES</span>
        <h1>Ingresa a tu plataforma.</h1>
        <p>Usa el correo y contraseña asociados a tu cuenta.</p>

        <form onSubmit={submit}>
          <label>
            Correo electrónico
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          <label>
            Contraseña
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required minLength={6} />
          </label>
          <div style={{ marginTop: -8, textAlign: "right", fontSize: 12 }}>
            <Link href="/forgot-password" style={{ color: "#bdf34b", fontWeight: 800 }}>¿Olvidaste tu contraseña?</Link>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          <button type="submit" disabled={loading}>{loading ? "Validando…" : "Ingresar"}</button>
        </form>

        <small className={styles.notice}>El acceso y las consultas quedan restringidos a usuarios autenticados.</small>
        <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,.08)", textAlign: "center", fontSize: 12, color: "#a1a1aa" }}>
          ¿Aún no tienes cuenta? <Link href="/registro" style={{ color: "#c084fc", fontWeight: 850 }}>Crear una cuenta trial</Link>
        </div>
      </section>
    </main>
  );
}
