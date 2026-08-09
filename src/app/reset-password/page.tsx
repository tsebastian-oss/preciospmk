"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { passwordPolicyError } from "@/lib/password-policy";
import styles from "../login/login.module.css";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    const policyError = passwordPolicyError(password);
    if (policyError) {
      setError(policyError);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No fue posible actualizar la contraseña.");
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible actualizar la contraseña.");
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
        <span className={styles.eyebrow}>NUEVA CONTRASEÑA</span>
        <h1>{done ? "Contraseña actualizada." : "Protege tu cuenta."}</h1>
        {done ? (
          <>
            <p>Tu contraseña se actualizó correctamente. Ya puedes volver a la plataforma.</p>
            <Link href="/" style={{ display: "block", textAlign: "center", borderRadius: 12, padding: "15px 18px", background: "#bdf34b", color: "#07100e", fontWeight: 850, textDecoration: "none" }}>
              Entrar a la plataforma
            </Link>
          </>
        ) : (
          <>
            <p>Usa al menos 10 caracteres, combina tres tipos de carácter y evita palabras, secuencias o datos personales fáciles de adivinar.</p>
            <form onSubmit={submit}>
              <label>
                Nueva contraseña
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required />
              </label>
              <label>
                Repetir contraseña
                <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required />
              </label>
              {error && <div className={styles.error}>{error}</div>}
              <button type="submit" disabled={loading}>{loading ? "Actualizando…" : "Guardar nueva contraseña"}</button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
