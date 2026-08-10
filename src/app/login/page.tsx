"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "./login.module.css";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("registered") === "1") {
      setNotice("Cuenta creada. Revisa tu correo y confirma tu dirección antes de ingresar. El enlace te llevará directamente a configurar tu trial.");
    } else if (query.get("confirmed") === "1") {
      setNotice("Correo confirmado correctamente. Ya puedes ingresar con tu contraseña.");
    }
  }, []);

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

        {notice && <div style={{ marginBottom: 18, padding: "13px 14px", borderRadius: 12, border: "1px solid rgba(189,243,75,.28)", background: "rgba(189,243,75,.08)", color: "#dfffa0", fontSize: 12, lineHeight: 1.55 }}>{notice}</div>}

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
