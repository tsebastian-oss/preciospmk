"use client";

import { useMemo, useState } from "react";
import styles from "./B2BDecisionLab.module.css";

type MacroZone = "Norte" | "Centro" | "Sur";

export type DecisionRow = {
  company: string;
  label: string;
  price: number;
  confidence: number;
  destinations: number;
  observations: number;
  channel: string;
  plan: string;
};

export type DecisionZone = {
  zone: MacroZone;
  rows: DecisionRow[];
};

type Props = {
  zones: DecisionZone[];
  selectedMonth: string;
  months: string[];
  history: Array<{
    month: string;
    zone: string;
    company: string;
    priceClp: number;
    confidence: number;
    destinations: number;
    observations: number;
    channel: string;
    plan: string;
  }>;
  onMonthChange: (month: string) => void;
};

type BeautifulDeck = {
  presentationId: string;
  title?: string;
  editorUrl?: string;
  playerUrl?: string;
  pptxUrl?: string;
  pdfUrl?: string;
  exportWarning?: string;
};

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function monthLabel(key: string) {
  const parsed = new Date(`${key}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  const label = new Intl.DateTimeFormat("es-CL", { month: "long" }).format(parsed);
  return `${label.charAt(0).toUpperCase() + label.slice(1)} 2026`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function actionForPremium(premium: number | null) {
  if (premium == null) return "Completar evidencia";
  if (premium >= 100) return "Crear tier / test";
  if (premium >= 45) return "Ajustar selectivamente";
  if (premium >= 15) return "Validar elasticidad";
  return "Defender posición";
}

export default function B2BDecisionLab({ zones, selectedMonth, months, history, onMonthChange }: Props) {
  const [selectedZone, setSelectedZone] = useState<MacroZone>("Norte");
  const [monthlyVolume, setMonthlyVolume] = useState(5000);
  const [priceChange, setPriceChange] = useState(-10);
  const [volumeChange, setVolumeChange] = useState(10);
  const [costShare, setCostShare] = useState(60);
  const [targetMargin, setTargetMargin] = useState(28);
  const [pptLoading, setPptLoading] = useState(false);
  const [pptNotice, setPptNotice] = useState("");
  const [excelLoading, setExcelLoading] = useState(false);
  const [beautifulDeck, setBeautifulDeck] = useState<BeautifulDeck | null>(null);

  const opportunityRows = useMemo(() => zones.map(({ zone, rows }) => {
    const sorted = [...rows].sort((a, b) => a.price - b.price);
    const leader = sorted[0] ?? null;
    const chilexpress = sorted.find((row) => row.company === "Chilexpress") ?? null;
    const premium = leader && chilexpress && leader.price > 0 ? (chilexpress.price / leader.price - 1) * 100 : null;
    const confidence = chilexpress?.confidence ?? 0;
    const gapScore = premium == null ? 0 : clamp(premium / 3.5, 0, 100);
    const opportunityScore = Math.round(gapScore * 0.8 + confidence * 0.2);

    return { zone, rows: sorted, leader, chilexpress, premium, opportunityScore, action: actionForPremium(premium) };
  }), [zones]);

  const current = opportunityRows.find((item) => item.zone === selectedZone) ?? opportunityRows[0];
  const currentPrice = current?.chilexpress?.price ?? 0;
  const leaderPrice = current?.leader?.price ?? 0;
  const assumedUnitCost = currentPrice > 0 ? currentPrice * clamp(costShare, 1, 99) / 100 : 0;
  const newPrice = currentPrice * (1 + priceChange / 100);
  const newVolume = Math.max(0, monthlyVolume * (1 + volumeChange / 100));
  const currentRevenue = currentPrice * monthlyVolume;
  const newRevenue = newPrice * newVolume;
  const currentContribution = (currentPrice - assumedUnitCost) * monthlyVolume;
  const newContribution = (newPrice - assumedUnitCost) * newVolume;
  const currentMargin = currentPrice > 0 ? (currentPrice - assumedUnitCost) / currentPrice * 100 : 0;
  const newMargin = newPrice > 0 ? (newPrice - assumedUnitCost) / newPrice * 100 : 0;
  const targetMarginRate = clamp(targetMargin, 1, 80) / 100;
  const marginFloorPrice = assumedUnitCost > 0 ? assumedUnitCost / (1 - targetMarginRate) : 0;
  const recommendedLow = leaderPrice > 0 && currentPrice > 0 ? Math.round(Math.max(marginFloorPrice, leaderPrice * 1.10)) : 0;
  const recommendedHigh = leaderPrice > 0 && currentPrice > 0 ? Math.round(Math.max(recommendedLow, Math.min(currentPrice * 0.92, leaderPrice * 1.60))) : 0;
  const recommendedMid = recommendedLow > 0 && recommendedHigh > 0 ? Math.round((recommendedLow + recommendedHigh) / 2) : 0;
  const discountVsCurrent = currentPrice > 0 && recommendedMid > 0 ? (recommendedMid / currentPrice - 1) * 100 : 0;

  const presentationPayload = {
    selectedMonth,
    zones,
    history,
    scenario: { selectedZone, monthlyVolume, priceChange, volumeChange, costShare, targetMargin },
  };

  const generateExecutivePpt = async () => {
    if (pptLoading) return;
    setPptLoading(true);
    setPptNotice("");
    setBeautifulDeck(null);
    try {
      const response = await fetch("/api/b2b-pricing/beautiful-presentation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(presentationPayload),
      });
      const result = await response.json().catch(() => null) as (BeautifulDeck & { error?: string }) | null;

      if (!response.ok || !result) {
        throw new Error(result?.error || "No fue posible generar la presentación en Beautiful.ai.");
      }

      setBeautifulDeck(result);
      setPptNotice(result.exportWarning
        ? `Presentación creada en Beautiful.ai. ${result.exportWarning}`
        : "Presentación creada en Beautiful.ai.");

      if (result.editorUrl) {
        window.open(result.editorUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setPptNotice(error instanceof Error ? error.message : "No fue posible generar la presentación.");
    } finally {
      setPptLoading(false);
    }
  };

  const downloadExecutiveExcel = async () => {
    if (excelLoading) return;
    setExcelLoading(true);
    setPptNotice("");
    try {
      const response = await fetch("/api/b2b-pricing/executive-excel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(presentationPayload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || "No fue posible generar el reporte Excel.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `chilexpress-pricing-directorio-${selectedMonth.replace("-", "")}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPptNotice("Reporte Excel para directorio generado.");
    } catch (error) {
      setPptNotice(error instanceof Error ? error.message : "No fue posible generar el reporte Excel.");
    } finally {
      setExcelLoading(false);
    }
  };

  const downloadLegacyPpt = async () => {
    if (pptLoading) return;
    setPptLoading(true);
    setPptNotice("");
    try {
      const response = await fetch("/api/b2b-pricing/executive-ppt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(presentationPayload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || "No fue posible generar el PPTX de respaldo.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `chilexpress-pricing-intelligence-${selectedMonth.replace("-", "")}.pptx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setPptNotice("PPTX de respaldo generado.");
    } catch (error) {
      setPptNotice(error instanceof Error ? error.message : "No fue posible generar el PPTX.");
    } finally {
      setPptLoading(false);
    }
  };

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>DECISION INTELLIGENCE</span>
        <h2>Motor de decisiones de pricing</h2>
        <p>Convierte el censo competitivo en acciones: prioriza zonas, modela impacto económico y define rangos de precio para testear.</p>
      </div>

      <div className={styles.heroActions}>
        <label className={styles.monthControl}>
          Mes analizado
          <select value={selectedMonth} onChange={(event) => onMonthChange(event.target.value)}>
            {months.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
          </select>
        </label>
        <div className={styles.presentationButtons}>
          <button type="button" className={styles.pptButton} disabled={pptLoading || !zones.some((zone) => zone.rows.length)} onClick={() => void generateExecutivePpt()}>
            {pptLoading ? "Generando…" : "Crear con Beautiful.ai"}
          </button>
          <button type="button" className={styles.excelButton} disabled={excelLoading || !zones.some((zone) => zone.rows.length)} onClick={() => void downloadExecutiveExcel()}>
            {excelLoading ? "Generando Excel…" : "Excel Directorio"}
          </button>
          <button type="button" className={styles.legacyPptButton} disabled={pptLoading || !zones.some((zone) => zone.rows.length)} onClick={() => void downloadLegacyPpt()}>
            PPTX respaldo
          </button>
        </div>
        {beautifulDeck ? <div className={styles.deckActions}>
          {beautifulDeck.editorUrl ? <a href={beautifulDeck.editorUrl} target="_blank" rel="noreferrer">Editar en Beautiful.ai ↗</a> : null}
          {beautifulDeck.playerUrl ? <a href={beautifulDeck.playerUrl} target="_blank" rel="noreferrer">Ver presentación ↗</a> : null}
          {beautifulDeck.pptxUrl ? <a href={beautifulDeck.pptxUrl} target="_blank" rel="noreferrer">Descargar PPTX ↓</a> : null}
          {beautifulDeck.pdfUrl ? <a href={beautifulDeck.pdfUrl} target="_blank" rel="noreferrer">Descargar PDF ↓</a> : null}
        </div> : null}
        {pptNotice ? <span className={styles.pptNotice}>{pptNotice}</span> : null}
      </div>
    </section>

    <section className={styles.block}>
      <div className={styles.blockHead}>
        <div><span>01 · MAPA DE OPORTUNIDADES</span><h3>¿Dónde debería actuar Chilexpress primero?</h3></div>
        <small>Score basado en brecha de precio y confianza del benchmark.</small>
      </div>

      <div className={styles.opportunityGrid}>
        {opportunityRows.map((item) => <button type="button" key={item.zone} className={selectedZone === item.zone ? styles.opportunityActive : styles.opportunityCard} onClick={() => setSelectedZone(item.zone)}>
          <div className={styles.opportunityTop}><div><span>MACROZONA</span><strong>{item.zone}</strong></div><b>{item.opportunityScore}/100</b></div>
          <div className={styles.scoreTrack}><i style={{ width: `${item.opportunityScore}%` }}/></div>
          <div className={styles.opportunityStats}>
            <div><span>Chilexpress</span><strong>{item.chilexpress ? money.format(item.chilexpress.price) : "—"}</strong></div>
            <div><span>Líder</span><strong>{item.leader ? `${item.leader.label} · ${money.format(item.leader.price)}` : "—"}</strong></div>
            <div><span>Premium</span><strong>{item.premium == null ? "—" : `+${pct.format(item.premium)}%`}</strong></div>
          </div>
          <div className={styles.actionBadge}>{item.action}</div>
        </button>)}
      </div>
    </section>

    <section className={styles.block}>
      <div className={styles.blockHead}>
        <div><span>02 · IMPACTO COMERCIAL</span><h3>¿Qué pasa si cambiamos precio y volumen?</h3></div>
        <small>Modelo demo con supuestos editables. No representa elasticidad real observada.</small>
      </div>

      <div className={styles.impactGrid}>
        <div className={styles.assumptions}>
          <label>Zona<select value={selectedZone} onChange={(event) => setSelectedZone(event.target.value as MacroZone)}>{opportunityRows.map((item) => <option key={item.zone}>{item.zone}</option>)}</select></label>
          <label>Volumen mensual actual<input type="number" min={0} step={100} value={monthlyVolume} onChange={(event) => setMonthlyVolume(Math.max(0, Number(event.target.value) || 0))}/></label>
          <label>Cambio de precio<div className={styles.rangeHeader}><b>{priceChange > 0 ? "+" : ""}{priceChange}%</b><span>vs precio actual</span></div><input className={styles.range} type="range" min={-30} max={20} step={1} value={priceChange} onChange={(event) => setPriceChange(Number(event.target.value))}/></label>
          <label>Cambio esperado de volumen<div className={styles.rangeHeader}><b>{volumeChange > 0 ? "+" : ""}{volumeChange}%</b><span>supuesto demo</span></div><input className={styles.range} type="range" min={-20} max={50} step={1} value={volumeChange} onChange={(event) => setVolumeChange(Number(event.target.value))}/></label>
          <label>Costo unitario supuesto<div className={styles.rangeHeader}><b>{costShare}%</b><span>del precio actual</span></div><input className={styles.range} type="range" min={35} max={85} step={1} value={costShare} onChange={(event) => setCostShare(Number(event.target.value))}/></label>
        </div>

        <div className={styles.impactResults}>
          <article><span>Precio actual</span><strong>{currentPrice ? money.format(currentPrice) : "—"}</strong><small>{selectedZone}</small></article>
          <article><span>Nuevo precio</span><strong>{newPrice ? money.format(newPrice) : "—"}</strong><small>{priceChange > 0 ? "+" : ""}{priceChange}%</small></article>
          <article><span>Ingresos mensuales</span><strong>{money.format(newRevenue)}</strong><small>{newRevenue >= currentRevenue ? "+" : ""}{pct.format(currentRevenue ? (newRevenue / currentRevenue - 1) * 100 : 0)}% vs actual</small></article>
          <article><span>Contribución estimada</span><strong>{money.format(newContribution)}</strong><small>{newContribution >= currentContribution ? "+" : ""}{pct.format(currentContribution ? (newContribution / currentContribution - 1) * 100 : 0)}% vs actual</small></article>
          <article><span>Margen estimado</span><strong>{pct.format(newMargin)}%</strong><small>actual: {pct.format(currentMargin)}%</small></article>
          <article><span>Volumen modelado</span><strong>{Math.round(newVolume).toLocaleString("es-CL")}</strong><small>envíos / mes</small></article>
        </div>
      </div>

      <p className={styles.disclaimer}>El modelo mantiene el costo unitario constante y usa una respuesta de volumen ingresada por el usuario. Sirve para discutir escenarios; no reemplaza una elasticidad estimada con datos reales de Chilexpress.</p>
    </section>

    <section className={styles.block}>
      <div className={styles.blockHead}>
        <div><span>03 · PRECIO RECOMENDADO DE TEST</span><h3>¿Qué rango conviene poner a prueba?</h3></div>
        <small>Combina líder competitivo, costo supuesto y margen objetivo.</small>
      </div>

      <div className={styles.recommendGrid}>
        <div className={styles.recommendControls}>
          <label>Zona<select value={selectedZone} onChange={(event) => setSelectedZone(event.target.value as MacroZone)}>{opportunityRows.map((item) => <option key={item.zone}>{item.zone}</option>)}</select></label>
          <label>Margen mínimo objetivo<div className={styles.rangeHeader}><b>{targetMargin}%</b><span>sobre precio de test</span></div><input className={styles.range} type="range" min={10} max={45} step={1} value={targetMargin} onChange={(event) => setTargetMargin(Number(event.target.value))}/></label>
          <label>Costo unitario supuesto<div className={styles.rangeHeader}><b>{costShare}%</b><span>del precio actual</span></div><input className={styles.range} type="range" min={35} max={85} step={1} value={costShare} onChange={(event) => setCostShare(Number(event.target.value))}/></label>
        </div>

        <div className={styles.recommendation}>
          <div className={styles.recommendationMain}>
            <span>Rango recomendado para test</span>
            <strong>{recommendedLow && recommendedHigh ? `${money.format(recommendedLow)} – ${money.format(recommendedHigh)}` : "Sin data comparable"}</strong>
            <small>{recommendedMid ? `Punto medio sugerido: ${money.format(recommendedMid)}` : "Requiere Chilexpress + líder comparable"}</small>
          </div>
          <div className={styles.recommendationStats}>
            <div><span>Chilexpress actual</span><b>{currentPrice ? money.format(currentPrice) : "—"}</b></div>
            <div><span>Líder de zona</span><b>{current?.leader ? `${current.leader.label} · ${money.format(current.leader.price)}` : "—"}</b></div>
            <div><span>Piso por margen</span><b>{marginFloorPrice ? money.format(marginFloorPrice) : "—"}</b></div>
            <div><span>Ajuste punto medio</span><b>{recommendedMid ? `${discountVsCurrent > 0 ? "+" : ""}${pct.format(discountVsCurrent)}%` : "—"}</b></div>
          </div>
          <p>Este rango es una recomendación de test, no un “precio óptimo”. El piso protege el margen objetivo bajo el costo supuesto y el techo acerca la oferta al mercado sin obligar a igualar al competidor más barato.</p>
        </div>
      </div>
    </section>
  </div>;
}
