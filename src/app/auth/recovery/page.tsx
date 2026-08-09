"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../../login/login.module.css";

export default function RecoveryCallbackPage() {
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [message, setMessage] = useState("Validando tu enlace seguro…");

  useEffect(() => {
    let cancelled = false;

    async function exchange() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const query = new URLSearchParams(window.location.search);
      const errorDescription = hash.get("error_description") || query.get("error_description");
      const type = hash.get("type") || query.get("type");
      const accessToken = hash.get("access_token") || query.get("access_token") || "";
      const refreshToken = hash.get("refresh_token") || query.get("refresh_token") || "";
      const expiresIn = Number(hash.get("expires_in") || query.get("expires_in") || "3600");

      if (errorDescription) {
        if (!cancelled) {
          setStatus("error");
          setMessage("El enlace de recuperación expiró o no es válido. Solicita uno nuevo.");
        }
        return;
      }

      if (type && type !== "recovery") {
        if (!cancelled) {
          setStatus("error");
          setMessage("Este enlace no corresponde a una recuperación de contraseña.");
        }
        return;
      }

      if (!accessToken || !refreshToken) {
        if (!cancelled) {
          setStatus("error");
          setMessage("No encontramos una sesión de recuperación válida en este enlace.");
        }
        return;
      }

      try {
        const response = await fetch("/api/auth/recovery/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessToken, refreshToken, expiresIn }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || "No fue posible validar el enlace.");
        window.history.replaceState(null, "", "/auth/recovery");
        window.location.replace("/reset-password");
      } catch (caught) {
        if (!cancelled) {
          setStatus("error");
          setMessage(caught instanceof Error ? caught.message : "No fue posible validar el enlace.");
        }
      }
    }

    void exchange();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className={styles.page}>
      <Link href="/landing" className={styles.brand}>
        <span>M</span>
        <div><strong>MGP Super Precios</strong><small>Price Intelligence Platform</small></div>
      </Link>
      <section className={styles.card}>
        <span className={styles.eyebrow}>RECUPERACIÓN SEGURA</span>
        <h1>{status === "loading" ? "Validando acceso." : "Necesitamos un enlace nuevo."}</h1>
        <p>{message}</p>
        {status === "error" && (
          <Link href="/forgot-password" style={{ display: "block", textAlign: "center", borderRadius: 12, padding: "15px 18px", background: "#bdf34b", color: "#07100e", fontWeight: 850, textDecoration: "none" }}>
            Solicitar nuevo enlace
          </Link>
        )}
      </section>
    </main>
  );
}
