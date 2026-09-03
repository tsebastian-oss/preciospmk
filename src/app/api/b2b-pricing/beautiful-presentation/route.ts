import { NextRequest } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import {
  beautifulAiConfigured,
  createBeautifulPresentation,
  exportBeautifulPresentation,
  type BeautifulSlide,
} from "@/lib/beautiful-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type ZoneName = "Norte" | "Centro" | "Sur";
type DecisionRow = {
  company: string;
  label: string;
  price: number;
  confidence: number;
  destinations: number;
  observations: number;
  channel: string;
  plan: string;
};
type DecisionZone = { zone: ZoneName; rows: DecisionRow[] };
type Scenario = {
  selectedZone?: string;
  monthlyVolume?: number;
  priceChange?: number;
  volumeChange?: number;
  costShare?: number;
  targetMargin?: number;
};

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function fmtMoney(value: number) {
  return money.format(Math.round(value || 0));
}

function fmtPct(value: number) {
  return `${pct.format(value || 0)}%`;
}

function monthLabel(key: string) {
  const parsed = new Date(`${key}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  const label = new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(parsed);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cleanZones(value: unknown): DecisionZone[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((zone: any) => ["Norte", "Centro", "Sur"].includes(zone?.zone) && Array.isArray(zone?.rows))
    .map((zone: any) => ({
      zone: zone.zone,
      rows: zone.rows
        .map((row: any) => ({
          company: String(row?.company ?? "").slice(0, 80),
          label: String(row?.label ?? row?.company ?? "").slice(0, 90),
          price: Number(row?.price ?? 0),
          confidence: Number(row?.confidence ?? 0),
          destinations: Number(row?.destinations ?? 0),
          observations: Number(row?.observations ?? 0),
          channel: String(row?.channel ?? "").slice(0, 60),
          plan: String(row?.plan ?? "").slice(0, 140),
        }))
        .filter((row: DecisionRow) => row.company && row.price > 0 && Number.isFinite(row.price))
        .sort((a: DecisionRow, b: DecisionRow) => a.price - b.price),
    }));
}

function enrich(zones: DecisionZone[]) {
  return zones.map((zone) => {
    const rows = [...zone.rows].sort((a, b) => a.price - b.price);
    const leader = rows[0] ?? null;
    const chilexpress = rows.find((row) => row.company === "Chilexpress") ?? null;
    const premium = leader && chilexpress && leader.price > 0 ? (chilexpress.price / leader.price - 1) * 100 : null;
    const confidence = chilexpress?.confidence ?? 0;
    const score = Math.round(clamp((premium ?? 0) / 3.5, 0, 100) * 0.8 + confidence * 0.2);
    return { ...zone, rows, leader, chilexpress, premium, score };
  });
}

function zoneTable(items: ReturnType<typeof enrich>) {
  return items.map((item) => {
    const lines = item.rows.map((row) => `${row.label}: ${fmtMoney(row.price)} (${Math.round(row.confidence)}% confianza)`).join("; ");
    return `${item.zone}: ${lines || "sin datos comparables"}`;
  }).join("\n");
}

export async function POST(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;

  try {
    if (!beautifulAiConfigured()) {
      return Response.json({
        error: "Beautiful.ai todavía no está conectado al backend. Configura BEAUTIFUL_AI_API_KEY en Vercel.",
        code: "beautiful_ai_not_configured",
      }, { status: 503 });
    }

    const body = await request.json();
    const zones = cleanZones(body?.zones);
    const selectedMonth = String(body?.selectedMonth ?? "").slice(0, 7) || "2026-09";
    const scenario = (body?.scenario ?? {}) as Scenario;
    const items = enrich(zones).filter((zone) => zone.rows.length);

    if (!items.length) {
      return Response.json({ error: "No hay data suficiente para generar la presentación." }, { status: 400 });
    }

    const mostPremium = [...items].sort((a, b) => (b.premium ?? -Infinity) - (a.premium ?? -Infinity))[0];
    const highestScore = [...items].sort((a, b) => b.score - a.score)[0];
    const selected = items.find((item) => item.zone === scenario.selectedZone) ?? highestScore;

    const currentPrice = selected?.chilexpress?.price ?? 0;
    const leaderPrice = selected?.leader?.price ?? 0;
    const monthlyVolume = Number(scenario.monthlyVolume ?? 5000);
    const priceChange = Number(scenario.priceChange ?? -10);
    const volumeChange = Number(scenario.volumeChange ?? 10);
    const costShare = Number(scenario.costShare ?? 60);
    const targetMargin = Number(scenario.targetMargin ?? 28);
    const unitCost = currentPrice * clamp(costShare, 1, 99) / 100;
    const newPrice = currentPrice * (1 + priceChange / 100);
    const newVolume = Math.max(0, monthlyVolume * (1 + volumeChange / 100));
    const currentRevenue = currentPrice * monthlyVolume;
    const newRevenue = newPrice * newVolume;
    const currentContribution = (currentPrice - unitCost) * monthlyVolume;
    const newContribution = (newPrice - unitCost) * newVolume;
    const currentMargin = currentPrice ? (currentPrice - unitCost) / currentPrice * 100 : 0;
    const newMargin = newPrice ? (newPrice - unitCost) / newPrice * 100 : 0;
    const floorPrice = unitCost / (1 - clamp(targetMargin, 1, 80) / 100);
    const recLow = leaderPrice > 0 && currentPrice > 0 ? Math.round(Math.max(floorPrice, leaderPrice * 1.1)) : 0;
    const recHigh = leaderPrice > 0 && currentPrice > 0 ? Math.round(Math.max(recLow, Math.min(currentPrice * 0.92, leaderPrice * 1.6))) : 0;
    const recMid = recLow && recHigh ? Math.round((recLow + recHigh) / 2) : 0;

    const title = `Chilexpress · Pricing Intelligence Courier B2B · ${monthLabel(selectedMonth)}`;
    const slides: BeautifulSlide[] = [
      {
        type: "title",
        title: "Pricing Intelligence Courier B2B",
        summary: `Reporte ejecutivo para Chilexpress · ${monthLabel(selectedMonth)}. Construido por MGP Super Precios con precios B2B comparables por macrozona, paquete ≤0,5 kg y foco Pyme/Empresa.`,
      },
      {
        type: "boxes-with-text",
        title: "Resumen ejecutivo",
        summary: `Prioridad de acción: ${highestScore?.zone ?? "—"} con score ${highestScore?.score ?? 0}/100. Mayor brecha competitiva: ${mostPremium?.zone ?? "—"} con premium Chilexpress ${mostPremium?.premium == null ? "sin comparación" : "+" + fmtPct(mostPremium.premium)} vs líder. Recomendación: actuar selectivamente por zona y volumen, no aplicar una rebaja transversal.`,
      },
      {
        type: "table",
        title: "Benchmark B2B por macrozona",
        summary: `Precios promedio comparables del mes seleccionado. Origen Santiago, paquete ≤0,5 kg, entrega a domicilio.\n${zoneTable(items)}`,
      },
      {
        type: "comparison-diagram",
        title: "Dónde está la mayor presión competitiva",
        summary: items.map((item) => `${item.zone}: Chilexpress ${item.chilexpress ? fmtMoney(item.chilexpress.price) : "sin dato"}; líder ${item.leader ? item.leader.label + " " + fmtMoney(item.leader.price) : "sin dato"}; premium ${item.premium == null ? "—" : "+" + fmtPct(item.premium)}; score ${item.score}/100.`).join("\n"),
      },
      {
        type: "chart",
        title: `Escenario comercial · ${selected?.zone ?? "—"}`,
        summary: `Supuestos: volumen actual ${Math.round(monthlyVolume).toLocaleString("es-CL")} envíos/mes; cambio de precio ${fmtPct(priceChange)}; cambio esperado de volumen ${fmtPct(volumeChange)}; costo unitario supuesto ${fmtPct(costShare)} del precio actual. Precio actual ${fmtMoney(currentPrice)} → ${fmtMoney(newPrice)}. Ingresos ${fmtMoney(currentRevenue)} → ${fmtMoney(newRevenue)}. Contribución ${fmtMoney(currentContribution)} → ${fmtMoney(newContribution)}. Margen ${fmtPct(currentMargin)} → ${fmtPct(newMargin)}.`,
      },
      {
        type: "arrow-bars",
        title: "Rango recomendado para test",
        summary: recLow && recHigh
          ? `Rango sugerido: ${fmtMoney(recLow)} – ${fmtMoney(recHigh)}. Punto medio: ${fmtMoney(recMid)}. Precio actual Chilexpress: ${fmtMoney(currentPrice)}. Líder de ${selected?.zone ?? "zona"}: ${selected?.leader ? selected.leader.label + " " + fmtMoney(selected.leader.price) : "sin dato"}. Piso por margen objetivo de ${fmtPct(targetMargin)}: ${fmtMoney(floorPrice)}. Es un rango de test, no un precio óptimo econométrico.`
          : "No existe data suficiente para construir un rango defendible de test.",
      },
      {
        type: "process-diagram",
        title: "Cómo convertir el benchmark en acción",
        summary: "1) Test comercial: activar oferta controlada por macrozona, recurrencia y volumen. 2) Medición: comparar conversión, retención, volumen y contribución contra grupo control. 3) Escalamiento: ampliar únicamente donde el lift comercial compense la pérdida de precio unitario.",
      },
      {
        type: "conclusion",
        title: "Próximo paso",
        summary: "Conectar costos reales de Chilexpress, conversión por segmento Pyme y resultados de campañas para pasar desde un rango de test competitivo a una recomendación econométrica de pricing.",
      },
    ];

    const created = await createBeautifulPresentation({
      title,
      slides,
      themeId: "dark",
      imageSource: "none",
      preserveExactText: true,
      language: "es",
      themeOptions: {
        typography: "modern",
        headerPosition: "left",
        fillStyle: "muted",
        backgroundColor: "dark",
        preferredShapes: "rounded",
        colors: ["#77D9A8", "#447CFF", "#FFD166"],
      },
    });

    let pptxUrl: string | undefined;
    let pdfUrl: string | undefined;
    let exportWarning: string | undefined;

    try {
      const [pptx, pdf] = await Promise.all([
        exportBeautifulPresentation(created.presentationId, "pptx"),
        exportBeautifulPresentation(created.presentationId, "pdf"),
      ]);
      pptxUrl = pptx.url;
      pdfUrl = pdf.url;
    } catch (error) {
      exportWarning = error instanceof Error ? error.message : "La presentación fue creada, pero no se pudo exportar automáticamente.";
    }

    return Response.json({
      ok: true,
      provider: "beautiful.ai",
      presentationId: created.presentationId,
      title: created.title || title,
      editorUrl: created.editorUrl,
      playerUrl: created.playerUrl,
      pptxUrl,
      pdfUrl,
      exportWarning,
    }, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("beautiful_presentation_error", error);
    const status = Number((error as Error & { status?: number })?.status || 500);
    return Response.json({
      error: error instanceof Error ? error.message : "No fue posible generar la presentación en Beautiful.ai.",
    }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}
