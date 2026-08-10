"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../../login/login.module.css";

type Status = "loading" | "error" | "success";

export default function ConfirmAccountPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState("Estamos verificando tu correo y preparando tu cuenta…");

  useEffect(() => {
    let cancelled = false;

    async function confirm() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const query = new URLSearchParams(window.location.search);
      const errorDescription = hash.get("error_description") || query.get("error_description");
      const accessToken = hash.get("access_token") || query.get("access_token") || "";
      const refreshToken = hash.get("refresh_token") || query.get("refresh_token") || "";
      const expiresIn = Number(hash.get("expires_in") || query.get("expires_in") || "3600");
      const tokenHash = query.get("token_hash") || "";
      const type = query.get("type") || hash.get("type") || "email";

      if (errorDescription) {
        if (!cancelled) {
          setStatus("error");
          setMessage("El enlace de confirmación expiró, ya fue utilizado o no es válido. Si ya confirmaste tu correo, intenta iniciar sesión.");
        }
        return;
      }

      if (!accessToken && !refreshToken && !tokenHash) {
        if (!cancelled) {
          setStatus("error");
          setMessage("El enlace no contiene una confirmación válida. Si tu correo ya fue verificado, puedes iniciar sesión normalmente.");
        }
        return;
      }

      try {
        const response = await fetch("/api/auth/confirmation/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessToken, refreshToken, expiresIn, tokenHash, type }),
        });
        const payload = await response.json() as { error?: string; next?: string };
        if (!response.ok) throw new Error(payload.error || "No fue posible confirmar tu cuenta.");
        if (cancelled) return;
        setStatus("success");
        setMessage("Correo confirmado. Tu cuenta está lista; te llevaremos a configurar tu trial.");
        window.history.replaceState(null, "", "/auth/confirm");
        window.setTimeout(() => window.location.replace(payload.next || "/onboarding"), 700);
      } catch (caught) {
        if (!cancelled) {
          setStatus("error");
          setMessage(caught instanceof Error ? caught.message : "No fue posible confirmar tu cuenta.");
        }
      }
    }

    void confirm();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className={styles.page}>
      <Link href="/landing" className={styles.brand}>
        <span>M</span>
        <div><strong>MGP Super Precios</strong><small>Price Intelligence Platform</small></div>
      </Link>
      <section className={styles.card}>
        <span className={styles.eyebrow}>VERIFICACIÓN DE CUENTA</span>
        <h1>{status === "loading" ? "Confirmando tu correo." : status === "success" ? "Cuenta confirmada." : "No pudimos confirmar el enlace."}</h1>
        <p>{message}</p>
        {status === "loading" && <div style={{ height: 4, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,.1)", marginTop: 20 }}><div style={{ width: "65%", height: "100%", background: "#bdf34b", borderRadius: 999 }} /></div>}
        {status === "success" && <div style={{ marginTop: 20, padding: 14, borderRadius: 12, background: "rgba(189,243,75,.1)", color: "#dfffa0", fontWeight: 800 }}>✓ Verificación completada</div>}
        {status === "error" && <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
          <Link href="/login" style={{ display: "block", textAlign: "center", borderRadius: 12, padding: "15px 18px", background: "#bdf34b", color: "#07100e", fontWeight: 850, textDecoration: "none" }}>Ir a iniciar sesión</Link>
          <Link href="/registro" style={{ textAlign: "center", color: "#c084fc", fontWeight: 800 }}>Volver al registro</Link>
        </div>}
      </section>
    </main>
  );
}
