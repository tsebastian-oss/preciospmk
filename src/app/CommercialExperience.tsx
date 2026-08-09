"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./CommercialExperience.module.css";

export type CommercialAccountPayload = {
  organization?: {
    id?: string;
    name?: string;
    status?: string;
    plan?: string;
    commercialPlan?: string | null;
    modules?: string[];
    limits?: Record<string, number | boolean | null>;
    commercial?: {
      status?: string;
      commercialPlan?: string;
      trialStartedAt?: string | null;
      trialExpiresAt?: string | null;
      intendedPlan?: string | null;
      billingCycle?: string | null;
      limits?: Record<string, number | boolean | null>;
      usage?: { exportsThisMonth?: number; activeUsers?: number; pendingInvitations?: number };
    } | null;
  };
};

const VIEW_MODULE: Record<string, string | null> = {
  overview: "overview",
  "price-image": "price-image",
  "price-matching": "pricing",
  "brand-ai": "brand-intelligence",
  "price-map": "optimizer",
  promotions: "promotions",
  assortment: "assortment-gaps",
  movements: "price-movements",
  products: "products",
  categories: "products",
  retailers: "products",
  downloads: "downloads",
  alerts: "alerts",
  scraping: "data-quality",
  settings: null,
};

export function requiredModuleForView(view: string) {
  return VIEW_MODULE[view] ?? null;
}

export function minimumPlanForView(view: string) {
  if (view === "scraping") return "Enterprise";
  if (["brand-ai", "price-map", "assortment"].includes(view)) return "Business";
  return "Starter";
}

export function commercialPlanLabel(value?: string | null) {
  const labels: Record<string, string> = {
    trial: "Trial",
    pilot: "Trial",
    starter: "Starter",
    retail_pilot: "Starter",
    business: "Business",
    retail_intelligence: "Business",
    enterprise: "Enterprise",
  };
  return labels[value ?? ""] ?? value ?? "Plan";
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? new Intl.NumberFormat("es-CL").format(parsed) : "0";
}

function daysRemaining(value?: string | null) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function CommercialBanner({ account }: { account: CommercialAccountPayload | null }) {
  const org = account?.organization;
  if (!org) return null;
  const commercial = org.commercial;
  const trial = org.status === "trial" || commercial?.commercialPlan === "trial";
  const days = daysRemaining(commercial?.trialExpiresAt);
  const limits = commercial?.limits ?? org.limits ?? {};
  const usage = commercial?.usage ?? {};
  const exportLimit = Number(limits.exports_per_month ?? 0);
  const exportsUsed = Number(usage.exportsThisMonth ?? 0);
  const userLimit = Number(limits.users ?? 0);
  const usersUsed = Number(usage.activeUsers ?? 0);
  const plan = commercialPlanLabel(commercial?.commercialPlan ?? org.commercialPlan ?? org.plan);

  if (!trial) {
    return <section className={`${styles.banner} ${styles.activeBanner}`}>
      <div><span>PLAN ACTIVO</span><strong>{plan}</strong><p>{org.name} · acceso según alcance contratado</p></div>
      <div className={styles.usage}><span><b>{number(usersUsed)}</b>{userLimit > 0 ? ` / ${number(userLimit)} usuarios` : " usuarios"}</span><span><b>{number(exportsUsed)}</b>{exportLimit > 0 ? ` / ${number(exportLimit)} exportaciones este mes` : " exportaciones este mes"}</span></div>
      <Link href="/cuenta">Administrar cuenta →</Link>
    </section>;
  }

  const urgency = days !== null && days <= 2;
  return <section className={`${styles.banner} ${urgency ? styles.urgent : ""}`}>
    <div>
      <span>TRIAL ACTIVO</span>
      <strong>{days === null ? "7 días para validar tu caso" : days === 0 ? "Tu trial vence hoy" : `${days} día${days === 1 ? "" : "s"} restantes`}</strong>
      <p>Explora tu alcance real, prueba la IA y valida el valor antes de elegir un plan.</p>
    </div>
    <div className={styles.usage}>
      <span><b>{number(exportsUsed)}</b>{exportLimit > 0 ? ` / ${number(exportLimit)} exportaciones` : " exportaciones"}</span>
      <span><b>{number(usersUsed)}</b>{userLimit > 0 ? ` / ${number(userLimit)} usuarios` : " usuarios"}</span>
    </div>
    <div className={styles.actions}>
      <Link href="/landing/precios">Ver planes</Link>
      <Link href="/landing/contacto#demo" className={styles.secondary}>Hablar con MGP</Link>
    </div>
  </section>;
}

const TRIAL_STEPS = [
  { view: "products", title: "Explora tu catálogo", copy: "Busca productos y valida la cobertura de tus retailers." },
  { view: "brand-ai", title: "Pregunta por una marca", copy: "Obtén un diagnóstico basado en datos reales." },
  { view: "price-map", title: "Construye un AI Price Map", copy: "Compara posicionamiento, cobertura y precio relativo." },
  { view: "downloads", title: "Exporta un análisis", copy: "Lleva los datos a Excel o CSV para tu equipo." },
] as const;

export function ActivationGuide({ currentView, onNavigate, account }: { currentView: string; onNavigate: (view: any) => void; account: CommercialAccountPayload | null }) {
  const org = account?.organization;
  const isTrial = org?.status === "trial";
  const modules = useMemo(() => new Set(org?.modules ?? []), [org?.modules]);
  const steps = useMemo(() => TRIAL_STEPS.filter((step) => {
    const required = requiredModuleForView(step.view);
    return !required || modules.size === 0 || modules.has(required);
  }), [modules]);
  const storageKey = `mgp-activation-${org?.id ?? "user"}`;
  const [completed, setCompleted] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTrial || typeof window === "undefined") return;
    try {
      const stored = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as string[];
      setCompleted(Array.isArray(stored) ? stored : []);
      setDismissed(window.localStorage.getItem(`${storageKey}-dismissed`) === "1");
    } catch { setCompleted([]); }
  }, [isTrial, storageKey]);

  useEffect(() => {
    if (!isTrial || !steps.some((step) => step.view === currentView)) return;
    setCompleted((current) => {
      if (current.includes(currentView)) return current;
      const next = [...current, currentView];
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [currentView, isTrial, steps, storageKey]);

  if (!isTrial || dismissed || currentView !== "overview" || steps.length === 0) return null;
  const done = steps.filter((step) => completed.includes(step.view)).length;
  return <section className={styles.guide}>
    <header><div><span>PRIMEROS PASOS</span><h2>Valida el producto en menos de 10 minutos</h2><p>{done} de {steps.length} acciones completadas</p></div><button onClick={() => { setDismissed(true); try { window.localStorage.setItem(`${storageKey}-dismissed`, "1"); } catch {} }}>×</button></header>
    <div className={styles.progress}><i style={{ width: `${Math.round(done / steps.length * 100)}%` }} /></div>
    <div className={styles.steps}>{steps.map((step, index) => {
      const isDone = completed.includes(step.view);
      return <button key={step.view} onClick={() => onNavigate(step.view)} className={isDone ? styles.done : ""}>
        <b>{isDone ? "✓" : index + 1}</b><span><strong>{step.title}</strong><small>{step.copy}</small></span><i>→</i>
      </button>;
    })}</div>
  </section>;
}
