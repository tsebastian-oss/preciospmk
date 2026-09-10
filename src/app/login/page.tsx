"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "./login.module.css";

type LoginResponse = { ok?: boolean; error?: string };

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nextPath, setNextPath] = useState("/entry");
  const [client, setClient] = useState("");

  const isVictorinox = client === "victorinox";

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const clientParam = query.get("client") || "";
    setClient(clientParam);
    if (clientParam === "victorinox") setEmail("victorinox@mgp-retail.internal");
    if (query.get("confirmed") === "1") {
      setNotice("Correo confirmado correctamente. Ya puedes ingresar con tu contraseña.");
    }
    const requestedNext = query.get("next");
    if (requestedNext && requestedNext.startsWith("/") && !requestedNext.startsWith("//")) {
      setNextPath(requestedNext);
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
      const raw = await response.text();
      let payload: LoginResponse = {};
      if (raw) {
        try { payload = JSON.parse(raw) as LoginResponse; } catch { payload = {}; }
      }
      if (!response.ok) {
        throw new Error(payload.error || (response.status >= 500 ? "El servicio de acceso está temporalmente no disponible. Intenta nuevamente en unos segundos." : "No fue posible iniciar sesión"));
      }
      window.location.href = nextPath;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error de autenticación");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={`${styles.page} ${isVictorinox ? styles.victorinoxPage : ""}`}>
      <Link href="/landing" className={styles.brand}>
        {isVictorinox ? (
          <img className={styles.clientLogo} src="/victorinox-brand.svg" alt="Victorinox" />
        ) : (
          <><span>M</span><div><strong>MGP Super Precios</strong><small>Price Intelligence Platform</small></div></>
        )}
      </Link>

      <section className={`${styles.card} ${isVictorinox ? styles.victorinoxCard : ""}`}>
        {isVictorinox && <img className={styles.heroLogo} src="/victorinox-brand.svg" alt="Victorinox" />}
        <span className={styles.eyebrow}>{isVictorinox ? "COMMERCIAL & PRICING INTELLIGENCE" : "ACCESO CLIENTES"}</span>
        <h1>{isVictorinox ? "Bienvenido a Victorinox Intelligence." : "Ingresa a tu plataforma."}</h1>
        <p>{isVictorinox ? "Accede a pricing, competencia, surtido, retailers, promociones e inteligencia de mercado para Chile." : "Usa el correo y contraseña asociados a tu cuenta."}</p>

        {notice && <div className={styles.success}>{notice}</div>}

        <form onSubmit={submit}>
          <label>
            Usuario o correo
            <input type="text" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
          </label>
          <label>
            Contraseña
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required minLength={6} />
          </label>
          <div className={styles.forgot}><Link href="/forgot-password">¿Olvidaste tu contraseña?</Link></div>
          {error && <div className={styles.error}>{error}</div>}
          <button type="submit" disabled={loading}>{loading ? "Validando…" : "Ingresar"}</button>
        </form>

        <small className={styles.notice}>{isVictorinox ? "Acceso privado · Victorinox Chile · Powered by MGP" : "El acceso y las consultas quedan restringidos a usuarios autenticados."}</small>
      </section>
    </main>
  );
}
