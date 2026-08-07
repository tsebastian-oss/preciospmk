"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { PageChrome } from "../landing/MarketingShell";
import styles from "../landing/marketing.module.css";

const INDUSTRIES = [
  ["grocery", "Supermercados / consumo masivo"],
  ["soft_drinks", "Bebidas sin alcohol"],
  ["alcoholic_beverages", "Bebidas alcohólicas"],
  ["beauty", "Belleza y cuidado personal"],
  ["health", "Salud / farmacias"],
  ["food", "Alimentos"],
  ["home", "Hogar"],
  ["technology", "Tecnología"],
  ["automotive", "Automotriz"],
  ["other", "Otra industria"],
] as const;

type RegisterResponse = { ok?: boolean; error?: string; requiresEmailConfirmation?: boolean; next?: string };

export default function RegisterPage() {
  const startedAt = useMemo(() => Date.now(), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<"" | "confirm">("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: form.get("displayName"),
          email: form.get("email"),
          phone: form.get("phone"),
          company: form.get("company"),
          jobTitle: form.get("jobTitle"),
          industrySlug: form.get("industrySlug"),
          password,
          acceptedTerms: form.get("acceptedTerms") === "on",
          website: form.get("website"),
          startedAt,
        }),
      });
      const payload = await response.json() as RegisterResponse;
      if (!response.ok) throw new Error(payload.error || "No fue posible crear la cuenta.");
      if (payload.requiresEmailConfirmation) {
        setSuccess("confirm");
        return;
      }
      window.location.href = payload.next || "/onboarding";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible crear la cuenta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageChrome active="registro">
      <main className={styles.registerPage}>
        <section className={styles.registerHero}>
          <div className={styles.registerValue}>
            <span className={styles.eyebrow}>CREA TU CUENTA · MGP SUPER PRECIOS</span>
            <h1>Empieza a explorar el mercado con una cuenta <em>trial</em>.</h1>
            <p>Crea el acceso de tu empresa y deja configurado tu espacio de trabajo. Registraremos la cuenta para acompañarte durante la activación y entender qué información necesita tu equipo.</p>
            <div className={styles.registerBenefits}>
              <article><b>01</b><div><strong>Tu empresa queda registrada</strong><span>Perfil, industria y responsable de la cuenta.</span></div></article>
              <article><b>02</b><div><strong>Espacio trial propio</strong><span>Organización separada y acceso inicial controlado.</span></div></article>
              <article><b>03</b><div><strong>Onboarding inmediato</strong><span>El sistema adapta el universo según tu industria.</span></div></article>
            </div>
            <div className={styles.registerTrust}><span>✓ Acceso protegido</span><span>✓ Sin tarjeta de crédito</span><span>✓ Soporte de MGP</span></div>
          </div>

          <section className={styles.registerCard}>
            {success === "confirm" ? (
              <div className={styles.registerSuccess}>
                <span>✉</span>
                <h2>Revisa tu correo</h2>
                <p>Tu cuenta fue creada. Por seguridad, confirma tu dirección de correo desde el mensaje que enviamos y luego ingresa con tu contraseña.</p>
                <Link href="/login" className={styles.registerPrimary}>Ir a ingresar</Link>
                <small>Si no recibes el correo, revisa spam o espera unos minutos antes de volver a intentarlo.</small>
              </div>
            ) : (
              <>
                <div className={styles.registerCardHead}>
                  <span>PASO 1 DE 2 · DATOS DE ACCESO</span>
                  <h2>Crea tu cuenta</h2>
                  <p>Ya tienes una cuenta? <Link href="/login">Ingresa aquí</Link></p>
                </div>
                <form onSubmit={submit} className={styles.registerForm}>
                  <input name="website" tabIndex={-1} autoComplete="off" className={styles.honeypot} aria-hidden="true" />
                  <label>Nombre y apellido<input name="displayName" required minLength={2} maxLength={120} placeholder="Ej. María González" autoComplete="name" /></label>
                  <label>Correo corporativo<input name="email" required type="email" maxLength={180} placeholder="maria@empresa.cl" autoComplete="email" /></label>
                  <label>Teléfono<input name="phone" maxLength={40} placeholder="+56 9 1234 5678" autoComplete="tel" /></label>
                  <label>Empresa<input name="company" required minLength={2} maxLength={160} placeholder="Nombre de tu empresa" autoComplete="organization" /></label>
                  <label>Cargo<input name="jobTitle" maxLength={120} placeholder="Ej. Pricing Manager" autoComplete="organization-title" /></label>
                  <label>Industria<select name="industrySlug" defaultValue=""><option value="">Selecciona una industria</option>{INDUSTRIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label>Contraseña<input name="password" required type="password" minLength={8} maxLength={128} placeholder="Mínimo 8 caracteres" autoComplete="new-password" /></label>
                  <label>Confirma contraseña<input name="confirmPassword" required type="password" minLength={8} maxLength={128} placeholder="Repite tu contraseña" autoComplete="new-password" /></label>
                  <label className={styles.registerTerms}><input name="acceptedTerms" type="checkbox" required /><span>Acepto los términos de uso y la política de privacidad de MGP Super Precios.</span></label>
                  {error && <div className={styles.registerError}>{error}</div>}
                  <button type="submit" disabled={loading}>{loading ? "Creando tu cuenta…" : "Crear cuenta trial →"}</button>
                  <small className={styles.registerFineprint}>Al crear tu cuenta, tu empresa quedará registrada en MGP para gestionar el acceso, onboarding y contacto comercial asociado al servicio.</small>
                </form>
              </>
            )}
          </section>
        </section>
      </main>
    </PageChrome>
  );
}
