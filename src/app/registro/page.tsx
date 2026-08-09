"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { PageChrome } from "../landing/MarketingShell";
import styles from "./register.module.css";

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

const PLANS = [["starter", "Starter"], ["business", "Business"], ["enterprise", "Enterprise"]] as const;
type RegisterResponse = { ok?: boolean; error?: string; requiresEmailConfirmation?: boolean; next?: string };

export default function RegisterPage() {
  const startedAt = useMemo(() => Date.now(), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<"" | "confirm">("");
  const [selectedPlan, setSelectedPlan] = useState("");

  useEffect(() => {
    const plan = new URLSearchParams(window.location.search).get("plan") ?? "";
    setSelectedPlan(["starter", "business", "enterprise"].includes(plan) ? plan : "");
  }, []);

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

    const classes = [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
    if (password.length < 10 || classes < 3) {
      setError("Usa al menos 10 caracteres y combina mayúsculas, minúsculas, números o símbolos.");
      setLoading(false);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const intendedPlan = selectedPlan || String(form.get("intendedPlan") ?? "");

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
          intendedPlan,
          utmSource: params.get("utm_source"),
          utmMedium: params.get("utm_medium"),
          utmCampaign: params.get("utm_campaign"),
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

  const selectedPlanLabel = PLANS.find(([value]) => value === selectedPlan)?.[1];

  return (
    <PageChrome active="registro">
      <main className={styles.registerPage}>
        <section className={styles.registerHero}>
          <div className={styles.registerValue}>
            <span className={styles.eyebrow}>CREA TU CUENTA · MGP SUPER PRECIOS</span>
            <h1>Empieza a explorar el mercado con una cuenta <em>trial</em>.</h1>
            <p>Prueba durante 7 días un entorno propio de inteligencia de precios. Sin tarjeta de crédito y con onboarding inmediato.</p>
            <div className={styles.registerBenefits}>
              <article><b>01</b><div><strong>7 días de trial</strong><span>Elige hasta 3 retailers con cobertura operativa y funcionalidades clave.</span></div></article>
              <article><b>02</b><div><strong>Espacio propio</strong><span>Tu empresa queda separada y configurada como organización.</span></div></article>
              <article><b>03</b><div><strong>Escala cuando veas valor</strong><span>Pasa a Starter, Business o Enterprise sin perder tu configuración.</span></div></article>
            </div>
            <div className={styles.registerTrust}><span>✓ Acceso protegido</span><span>✓ Sin tarjeta de crédito</span><span>✓ Soporte de MGP</span></div>
            <p style={{ marginTop: 18, fontSize: 12 }}><Link href="/landing/cobertura">Revisar cobertura actual de retailers →</Link></p>
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
                  <h2>{selectedPlanLabel ? `Trial orientado a ${selectedPlanLabel}` : "Crea tu cuenta"}</h2>
                  <p>¿Ya tienes una cuenta? <Link href="/login">Ingresa aquí</Link></p>
                </div>
                <form onSubmit={submit} className={styles.registerForm}>
                  <input name="website" tabIndex={-1} autoComplete="off" className={styles.honeypot} aria-hidden="true" />
                  <label>Nombre y apellido<input name="displayName" required minLength={2} maxLength={120} placeholder="Ej. María González" autoComplete="name" /></label>
                  <label>Correo corporativo<input name="email" required type="email" maxLength={180} placeholder="maria@empresa.cl" autoComplete="email" /></label>
                  <label>Teléfono<input name="phone" maxLength={40} placeholder="+56 9 1234 5678" autoComplete="tel" /></label>
                  <label>Empresa<input name="company" required minLength={2} maxLength={160} placeholder="Nombre de tu empresa" autoComplete="organization" /></label>
                  <label>Cargo<input name="jobTitle" maxLength={120} placeholder="Ej. Pricing Manager" autoComplete="organization-title" /></label>
                  <label>Industria<select name="industrySlug" defaultValue=""><option value="">Selecciona una industria</option>{INDUSTRIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label>Plan que te interesa<select name="intendedPlan" value={selectedPlan} onChange={(event) => setSelectedPlan(event.target.value)}><option value="">Aún no lo sé</option>{PLANS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label>Contraseña<input name="password" required type="password" minLength={10} maxLength={128} placeholder="10+ caracteres y 3 tipos de carácter" autoComplete="new-password" /></label>
                  <label>Confirma contraseña<input name="confirmPassword" required type="password" minLength={10} maxLength={128} placeholder="Repite tu contraseña" autoComplete="new-password" /></label>
                  <label className={styles.registerTerms}><input name="acceptedTerms" type="checkbox" required /><span>Acepto los <Link href="/landing/legal/terminos" target="_blank">términos de uso</Link> y la <Link href="/landing/legal/privacidad" target="_blank">política de privacidad</Link> de MGP Super Precios.</span></label>
                  {error && <div className={styles.registerError}>{error}</div>}
                  <button type="submit" disabled={loading}>{loading ? "Creando tu cuenta…" : "Comenzar trial de 7 días →"}</button>
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
