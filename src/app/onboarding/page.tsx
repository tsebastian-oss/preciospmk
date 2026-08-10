"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./onboarding.module.css";

type Industry = {
  slug: string;
  name: string;
  description: string;
  retailer_types: string[];
  display_order: number;
};
type RetailerOption = { name: string; products: number; freshnessStatus?: string; latestObservedAt?: string | null };
type RetailerChannel = { code: string; name: string; retailers: RetailerOption[] };
type Payload = {
  industries?: Industry[];
  industrySlug?: string | null;
  industryName?: string | null;
  industryConfigured?: boolean;
  trialScopeConfigured?: boolean;
  organizationName?: string;
  organizationStatus?: string;
  retailers?: string[];
  channels?: RetailerChannel[];
  error?: string;
};

const ICONS: Record<string, string> = {
  all: "◎", grocery: "▦", food: "◫", soft_drinks: "◉", alcoholic_beverages: "◆",
  textiles: "✦", technology: "⌘", home: "⌂", beauty: "✧", health: "+",
  toys: "◇", sports: "↗", automotive: "◈", pets: "♢", other: "…",
};
const CHANNEL_ICONS: Record<string, string> = { supermarket: "▦", pharmacy: "+", department_store: "▤" };

function suggestedChannels(industry: string) {
  if (industry === "health") return ["pharmacy"];
  if (industry === "beauty") return ["pharmacy", "supermarket"];
  if (["textiles", "technology", "home", "toys", "sports"].includes(industry)) return ["department_store"];
  if (industry === "all" || industry === "other") return ["supermarket", "pharmacy", "department_store"];
  return ["supermarket"];
}

function channelCodesForRetailers(channels: RetailerChannel[], retailers: string[]) {
  const selected = new Set(retailers.map((value) => value.toLocaleLowerCase("es-CL")));
  return channels
    .filter((channel) => channel.retailers.some((retailer) => selected.has(retailer.name.toLocaleLowerCase("es-CL"))))
    .map((channel) => channel.code);
}

function freshness(retailer: RetailerOption) {
  if (retailer.freshnessStatus === "warning") return "Actualización en revisión";
  return "Actualización activa";
}

export default function OnboardingPage() {
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [selected, setSelected] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationStatus, setOrganizationStatus] = useState("");
  const [channels, setChannels] = useState<RetailerChannel[]>([]);
  const [activeChannels, setActiveChannels] = useState<string[]>([]);
  const [selectedRetailers, setSelectedRetailers] = useState<string[]>([]);
  const [trialScopeConfigured, setTrialScopeConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const changing = useMemo(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("change") === "1", []);
  const isTrial = organizationStatus === "trial";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/enterprise/industry?includeRetailers=1", { cache: "no-store" });
        const payload = await response.json() as Payload;
        if (!response.ok) {
          const reason = payload.error || "No fue posible cargar las industrias";
          if (response.status === 403 && reason.toLocaleLowerCase("es-CL").includes("suspend")) {
            window.location.replace("/trial-expired");
            return;
          }
          throw new Error(reason);
        }
        if (!cancelled) {
          const availableChannels = payload.channels ?? [];
          const currentRetailers = payload.trialScopeConfigured ? payload.retailers ?? [] : [];
          const industry = payload.industrySlug ?? "";
          setIndustries(payload.industries ?? []);
          setSelected(industry);
          setOrganizationName(payload.organizationName ?? "");
          setOrganizationStatus(payload.organizationStatus ?? "");
          setChannels(availableChannels);
          setTrialScopeConfigured(Boolean(payload.trialScopeConfigured));
          setSelectedRetailers(currentRetailers);
          setActiveChannels(
            currentRetailers.length
              ? channelCodesForRetailers(availableChannels, currentRetailers)
              : suggestedChannels(industry),
          );
          if (payload.industryConfigured && !changing) window.location.replace("/");
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "No fue posible cargar la configuración");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [changing]);

  function chooseIndustry(slug: string) {
    setSelected(slug);
    setError("");
    if (organizationStatus === "trial" && !trialScopeConfigured) {
      setSelectedRetailers([]);
      setActiveChannels(suggestedChannels(slug));
    }
  }

  function toggleChannel(code: string) {
    setError("");
    setActiveChannels((current) => {
      if (current.includes(code)) {
        const retailerNames = new Set(
          channels.find((channel) => channel.code === code)?.retailers.map((retailer) => retailer.name) ?? [],
        );
        setSelectedRetailers((selectedNames) => selectedNames.filter((name) => !retailerNames.has(name)));
        return current.filter((item) => item !== code);
      }
      return [...current, code];
    });
  }

  function toggleRetailer(name: string) {
    setError("");
    setSelectedRetailers((current) => {
      if (current.includes(name)) return current.filter((item) => item !== name);
      if (current.length >= 3) {
        setError("El trial permite elegir hasta 3 retailers. Quita uno para seleccionar otro.");
        return current;
      }
      return [...current, name];
    });
  }

  async function save() {
    if (!selected) return;
    if (isTrial && (selectedRetailers.length < 1 || selectedRetailers.length > 3)) {
      setError("Selecciona entre 1 y 3 retailers para comenzar el trial.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/enterprise/industry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ industrySlug: selected, retailers: isTrial ? selectedRetailers : undefined }),
      });
      const payload = await response.json() as Payload;
      if (!response.ok) {
        const reason = payload.error || "No fue posible guardar la configuración";
        if (response.status === 403 && reason.toLocaleLowerCase("es-CL").includes("suspend")) {
          window.location.replace("/trial-expired");
          return;
        }
        throw new Error(reason);
      }
      window.location.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible guardar la configuración");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className={styles.page}><div className={styles.loading}>Preparando tu trial…</div></main>;

  return <main className={styles.page}>
    <div className={styles.shell}>
      <div className={styles.brand}><div className={styles.mark}>M</div><div><strong>MGP Super Precios</strong><small>Configuración inicial</small></div></div>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>{changing ? "CONFIGURACIÓN" : "PERSONALIZA TU PLATAFORMA"}</span>
        <h1>Configura el mercado que quieres monitorear.</h1>
        <p>{isTrial ? "Primero cuéntanos en qué industria compites. Luego elige los canales y hasta 3 retailers con cobertura operativa para tu trial." : "Usaremos esta selección para priorizar categorías, productos, variaciones de precio y comparaciones relevantes para tu negocio."}</p>
        {organizationName && <div className={styles.context}>Organización: <strong>{organizationName}</strong>{isTrial && <span>Trial</span>}</div>}
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.step}>
        <div className={styles.stepHead}><span>01</span><div><b>Industria</b><p>Define el universo de productos que priorizará la plataforma.</p></div></div>
        <div className={styles.grid}>
          {industries.map((industry) => <button key={industry.slug} type="button" onClick={() => chooseIndustry(industry.slug)} className={`${styles.card} ${selected === industry.slug ? styles.selected : ""}`}>
            <span className={styles.icon}>{ICONS[industry.slug] ?? "•"}</span>
            <span className={styles.check}>✓</span>
            <b>{industry.name}</b>
            <p>{industry.description}</p>
          </button>)}
        </div>
      </section>

      {isTrial && <section className={styles.step}>
        <div className={styles.stepHead}><span>02</span><div><b>Canales</b><p>Activa uno o más canales. Puedes combinar supermercados, farmacias y multitiendas.</p></div></div>
        <div className={styles.channelGrid}>
          {channels.map((channel) => {
            const active = activeChannels.includes(channel.code);
            return <button type="button" key={channel.code} onClick={() => toggleChannel(channel.code)} className={`${styles.channelCard} ${active ? styles.channelActive : ""}`}>
              <i>{CHANNEL_ICONS[channel.code] ?? "•"}</i><div><strong>{channel.name}</strong><small>{channel.retailers.length} retailer{channel.retailers.length === 1 ? "" : "s"} disponibles</small></div><span>{active ? "✓" : "+"}</span>
            </button>;
          })}
        </div>

        <div className={styles.retailerHead}><div><b>Elige hasta 3 retailers</b><p>Solo mostramos fuentes con datos utilizables; si una está en revisión lo verás antes de seleccionarla.</p></div><strong>{selectedRetailers.length}/3 seleccionados</strong></div>
        <div className={styles.retailerGroups}>
          {channels.filter((channel) => activeChannels.includes(channel.code)).map((channel) => <div key={channel.code} className={styles.retailerGroup}>
            <span>{channel.name}</span>
            <div className={styles.retailerGrid}>{channel.retailers.map((retailer) => {
              const active = selectedRetailers.includes(retailer.name);
              return <button type="button" key={retailer.name} onClick={() => toggleRetailer(retailer.name)} className={`${styles.retailerButton} ${active ? styles.retailerSelected : ""}`}>
                <b>{retailer.name}</b><small>{new Intl.NumberFormat("es-CL").format(retailer.products)} SKUs · {freshness(retailer)}</small><i>{active ? "✓" : "+"}</i>
              </button>;
            })}</div>
          </div>)}
          {!activeChannels.length && <div className={styles.emptyChannels}>Selecciona al menos un canal para ver sus retailers.</div>}
        </div>
      </section>}

      <footer className={styles.footer}>
        <p>{isTrial ? "Podrás probar hasta 3 retailers durante 7 días. Si ajustas la selección, recalcularemos automáticamente el dashboard con el nuevo alcance." : "La industria se combina con los retailers, marcas y categorías contratadas por tu organización."}</p>
        <button className={styles.continue} disabled={!selected || saving || (isTrial && selectedRetailers.length === 0)} onClick={save}>{saving ? "Preparando tu dashboard…" : changing ? "Guardar cambios" : "Entrar a la plataforma"}</button>
      </footer>
    </div>
  </main>;
}
