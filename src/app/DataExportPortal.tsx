"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import DataExportSmartFilters from "./DataExportSmartFilters";
import platformStyles from "./platform-dashboard.module.css";
import styles from "./DataExportPortal.module.css";

type ExportFormat = "xlsx" | "csv";
type ExportJob = {
  id: string;
  report_type: string;
  format: ExportFormat;
  status: "queued" | "processing" | "completed" | "failed" | "expired";
  parameters: {
    dataset?: string;
    startDate?: string;
    endDate?: string;
    supermarket?: string | null;
    category?: string | null;
    productIds?: string[];
    selectedProductCount?: number;
  };
  result_url: string | null;
  result_metadata: {
    rows?: number;
    bytes?: number;
    expiresAt?: string;
    truncated?: boolean;
    maxRows?: number;
  } | null;
  error_message: string | null;
  requested_at: string;
  completed_at: string | null;
};
type Availability = {
  firstDate: string | null;
  lastDate: string | null;
  observations: number;
  products: number;
  retailers: Array<{ supermarket: string; observations: number }>;
};
type ExportPayload = {
  exports: ExportJob[];
  availability: Availability | null;
  error?: string;
};
type CreatePayload = { job?: ExportJob; error?: string; detail?: string };

const integer = new Intl.NumberFormat("es-CL");
const bytes = new Intl.NumberFormat("es-CL", { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });

function dateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function offsetDate(days: number, base = new Date()) {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return dateValue(date);
}

function displayDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}

function displayDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function statusLabel(status: ExportJob["status"]) {
  if (status === "completed") return "Disponible";
  if (status === "processing") return "Generando";
  if (status === "failed") return "Fallida";
  if (status === "expired") return "Expirada";
  return "En cola";
}

function triggerDownload(url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export default function DataExportPortal() {
  const [navTarget, setNavTarget] = useState<HTMLElement | null>(null);
  const [mainTarget, setMainTarget] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [history, setHistory] = useState<ExportJob[]>([]);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [startDate, setStartDate] = useState(offsetDate(-6));
  const [endDate, setEndDate] = useState(offsetDate(0));
  const [supermarket, setSupermarket] = useState("");
  const [category, setCategory] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const datesInitialized = useRef(false);
  const pendingDownloadJob = useRef<string | null>(null);

  useEffect(() => {
    let currentNav: HTMLElement | null = null;
    let currentMain: HTMLElement | null = null;
    const syncTargets = () => {
      const nextNav = document.querySelector<HTMLElement>(".sidebar nav");
      const nextMain = document.querySelector<HTMLElement>(".app-shell > main");
      if (nextNav !== currentNav) {
        currentNav = nextNav;
        setNavTarget(nextNav);
      }
      if (nextMain !== currentMain) {
        currentMain?.classList.remove(styles.exportMode);
        currentMain = nextMain;
        setMainTarget(nextMain);
      }
    };
    const syncHash = () => setActive(window.location.hash.replace("#", "") === "data-exports");
    syncTargets();
    syncHash();
    const observer = new MutationObserver(syncTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", syncHash);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", syncHash);
      currentMain?.classList.remove(styles.exportMode);
    };
  }, []);

  useEffect(() => {
    if (!mainTarget) return;
    if (active) {
      mainTarget.classList.add(styles.exportMode);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      mainTarget.classList.remove(styles.exportMode);
    }
    return () => mainTarget.classList.remove(styles.exportMode);
  }, [active, mainTarget]);

  const loadHistory = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/data-exports?live=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json() as ExportPayload;
      if (!response.ok) throw new Error(payload.error || "No fue posible cargar las exportaciones");
      const exports = payload.exports ?? [];
      setHistory(exports);
      setAvailability(payload.availability ?? null);
      const pending = pendingDownloadJob.current;
      const pendingResult = pending ? exports.find((job) => job.id === pending) : null;
      if (pendingResult?.status === "completed" && pendingResult.result_url) {
        pendingDownloadJob.current = null;
        triggerDownload(pendingResult.result_url);
        setError("");
      } else if (pendingResult?.status === "failed") {
        pendingDownloadJob.current = null;
        setError(pendingResult.error_message || "No fue posible generar el archivo.");
      } else if (!pendingResult) {
        setError("");
      }
      if (!datesInitialized.current && payload.availability?.lastDate) {
        const last = payload.availability.lastDate;
        const lastDate = new Date(`${last}T12:00:00`);
        const suggestedStart = offsetDate(-6, lastDate);
        setEndDate(last);
        setStartDate(payload.availability.firstDate && payload.availability.firstDate > suggestedStart
          ? payload.availability.firstDate
          : suggestedStart);
        datesInitialized.current = true;
      }
    } catch (reason) {
      if (!quiet) setError(reason instanceof Error ? reason.message : "No fue posible cargar las exportaciones");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadHistory();
    const interval = window.setInterval(() => void loadHistory(true), 10_000);
    return () => window.clearInterval(interval);
  }, [active, loadHistory]);

  const retailerOptions = useMemo(() => availability?.retailers?.map((item) => item.supermarket) ?? ["Jumbo", "Santa Isabel", "Lider"], [availability]);

  function applyPreset(days: number) {
    const base = availability?.lastDate ? new Date(`${availability.lastDate}T12:00:00`) : new Date();
    const nextEnd = dateValue(base);
    let nextStart = offsetDate(-(days - 1), base);
    if (availability?.firstDate && availability.firstDate > nextStart) nextStart = availability.firstDate;
    setStartDate(nextStart);
    setEndDate(nextEnd);
  }

  function changeSupermarket(value: string) {
    setSupermarket(value);
    setCategory("");
    setSelectedProductIds([]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setGenerating(true);
    setError("");
    try {
      const response = await fetch("/api/data-exports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          supermarket: supermarket || null,
          category: category || null,
          productIds: selectedProductIds,
          format,
        }),
      });
      const payload = await response.json() as CreatePayload;
      if (!response.ok || !payload.job) throw new Error(payload.error || payload.detail || "No fue posible generar el archivo");
      if (payload.job.status === "completed" && payload.job.result_url) {
        triggerDownload(payload.job.result_url);
      } else {
        pendingDownloadJob.current = payload.job.id;
      }
      await loadHistory(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible generar el archivo");
    } finally {
      setGenerating(false);
    }
  }

  const navPortal = navTarget ? createPortal(
    <div className={platformStyles.navGroup}>
      <div><span>Data Management</span><small>1 módulo</small></div>
      <button className={active ? "active" : ""} onClick={() => { window.location.hash = "data-exports"; }}>
        <span>Descarga de bases</span><small>Excel / CSV</small>
      </button>
    </div>,
    navTarget,
  ) : null;

  const contentPortal = active && mainTarget ? createPortal(
    <section className={styles.workspaceRoot}>
      <header className={styles.hero}>
        <div><span>DATA MANAGEMENT</span><h1>Descarga de bases</h1><p>Exporta el histórico de precios respetando la industria, cadenas, marcas, categorías y productos autorizados para tu organización.</p></div>
        <div className={styles.coverage}><span>Histórico disponible</span><strong>{availability?.firstDate && availability.lastDate ? `${displayDate(availability.firstDate)} — ${displayDate(availability.lastDate)}` : "Cargando…"}</strong><small>{integer.format(availability?.observations ?? 0)} observaciones · {integer.format(availability?.products ?? 0)} productos</small></div>
      </header>

      {error && <div className={styles.error}>{error}<button onClick={() => setError("")}>×</button></div>}

      <div className={styles.layout}>
        <form className={styles.builder} onSubmit={submit}>
          <div className={styles.sectionHead}><div><span>NUEVA EXPORTACIÓN</span><h2>Configura la base</h2></div><b>Histórico por SKU</b></div>

          <div className={styles.presets}><span>Período rápido</span><div><button type="button" onClick={() => applyPreset(1)}>Último día</button><button type="button" onClick={() => applyPreset(7)}>7 días</button><button type="button" onClick={() => applyPreset(30)}>30 días</button></div></div>

          <div className={styles.fieldGrid}>
            <label><span>Desde</span><input type="date" value={startDate} min={availability?.firstDate ?? undefined} max={endDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
            <label><span>Hasta</span><input type="date" value={endDate} min={startDate} max={availability?.lastDate ?? offsetDate(0)} onChange={(event) => setEndDate(event.target.value)} required /></label>
            <label className={styles.full}><span>Cadena</span><select value={supermarket} onChange={(event) => changeSupermarket(event.target.value)}><option value="">Todas las cadenas autorizadas</option>{retailerOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </div>

          <DataExportSmartFilters
            supermarket={supermarket}
            category={category}
            selectedProductIds={selectedProductIds}
            onCategoryChange={setCategory}
            onSelectedProductIdsChange={setSelectedProductIds}
          />

          <div className={styles.formatBlock}><span>Formato de salida</span><div className={styles.formats}>
            <button type="button" className={format === "xlsx" ? styles.selected : ""} onClick={() => setFormat("xlsx")}><b>XLSX</b><strong>Excel</strong><small>Ideal para análisis y tablas dinámicas</small></button>
            <button type="button" className={format === "csv" ? styles.selected : ""} onClick={() => setFormat("csv")}><b>CSV</b><strong>Base plana</strong><small>Recomendado para períodos extensos</small></button>
          </div></div>

          <div className={styles.columns}><span>Columnas incluidas</span><p>Fecha, cadena, industria, SKU, producto, marca, categoría, precio regular, precio oferta, precio efectivo, unidad, precio unitario, stock, observación y URL de origen.</p></div>

          <button className={styles.generate} disabled={generating || !startDate || !endDate}>{generating ? <><i /> Generando archivo…</> : <>↓ Generar y descargar</>}</button>
          <small className={styles.limit}>Los archivos se almacenan temporalmente durante siete días. Para volúmenes grandes, CSV ofrece mejor rendimiento.</small>
        </form>

        <aside className={styles.sidePanel}>
          <div className={styles.sideHead}><div><span>EXPORTACIONES RECIENTES</span><h2>Historial de descargas</h2></div><button onClick={() => void loadHistory()}>↻</button></div>
          {loading ? <div className={styles.loading}><i />Cargando historial…</div> : !history.length ? <div className={styles.empty}>Todavía no existen archivos generados.</div> : <div className={styles.history}>{history.map((job) => {
            const expired = Boolean(job.result_metadata?.expiresAt && new Date(job.result_metadata.expiresAt).getTime() < Date.now());
            const downloadable = job.status === "completed" && job.result_url && !expired;
            const selection = [job.parameters.supermarket || "Todas las cadenas", job.parameters.category].filter(Boolean).join(" · ");
            return <article key={job.id}>
              <div className={styles.jobTop}><b>{job.format.toUpperCase()}</b><span className={styles[job.status]}>{expired ? "Expirada" : statusLabel(job.status)}</span></div>
              <strong>{selection}</strong>
              <p>{displayDate(job.parameters.startDate)} — {displayDate(job.parameters.endDate)}</p>
              {Boolean(job.parameters.selectedProductCount) && <small className={styles.warning}>{integer.format(job.parameters.selectedProductCount ?? 0)} SKU seleccionados</small>}
              <div className={styles.jobMeta}><span>{integer.format(job.result_metadata?.rows ?? 0)} filas</span><span>{job.result_metadata?.bytes ? bytes.format(job.result_metadata.bytes / 1_000_000) : displayDateTime(job.requested_at)}</span></div>
              {job.result_metadata?.truncated && <small className={styles.warning}>Archivo limitado a {integer.format(job.result_metadata.maxRows ?? 0)} filas.</small>}
              {job.status === "failed" && <small className={styles.warning}>{job.error_message || "No fue posible generar el archivo."}</small>}
              <button disabled={!downloadable} onClick={() => downloadable && triggerDownload(job.result_url as string)}>{downloadable ? "Descargar archivo ↓" : expired ? "Enlace expirado" : job.status === "failed" ? "Generación fallida" : "Procesando…"}</button>
            </article>;
          })}</div>}
        </aside>
      </div>
    </section>,
    mainTarget,
  ) : null;

  return <>{navPortal}{contentPortal}</>;
}
