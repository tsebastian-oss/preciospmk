import { NextRequest } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";

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

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

const C = {
  ink: "06101D",
  navy: "081827",
  panel: "0D1F31",
  panel2: "102942",
  panel3: "0A1724",
  line: "28415A",
  line2: "355772",
  text: "F4F8FB",
  muted: "9AAEC0",
  dim: "6E8193",
  green: "77D9A8",
  green2: "2CBF78",
  cyan: "6CB6FF",
  blue: "447CFF",
  yellow: "FFD166",
  red: "FB7185",
  white: "FFFFFF",
};

const FONT = {
  head: "Aptos Display",
  body: "Aptos",
  mono: "Aptos Mono",
};

function fmtMoney(value: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(Math.round(value || 0));
}

function fmtPct(value: number) {
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value || 0)}%`;
}

function fmtNum(value: number) {
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(Math.round(value || 0));
}

function monthLabel(key: string) {
  const parsed = new Date(`${key}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  const label = new Intl.DateTimeFormat("es-CL", { month: "long" }).format(parsed);
  return `${label.charAt(0).toUpperCase() + label.slice(1)} 2026`;
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

function actionForPremium(premium: number | null) {
  if (premium == null) return "Completar evidencia";
  if (premium >= 100) return "Crear tier / test";
  if (premium >= 45) return "Ajustar selectivamente";
  if (premium >= 15) return "Validar elasticidad";
  return "Defender posición";
}

function enrich(zones: DecisionZone[]) {
  return zones.map((zone) => {
    const rows = [...zone.rows].sort((a, b) => a.price - b.price);
    const leader = rows[0] ?? null;
    const chilexpress = rows.find((row) => row.company === "Chilexpress") ?? null;
    const premium = leader && chilexpress && leader.price > 0 ? (chilexpress.price / leader.price - 1) * 100 : null;
    const confidence = chilexpress?.confidence ?? 0;
    const score = Math.round(clamp((premium ?? 0) / 3.5, 0, 100) * 0.8 + confidence * 0.2);
    return { ...zone, rows, leader, chilexpress, premium, score, action: actionForPremium(premium) };
  });
}

function createPptShapeTypes(pptx: any) {
  return {
    rect: pptx.ShapeType.rect,
    roundRect: pptx.ShapeType.roundRect,
    line: pptx.ShapeType.line,
    oval: pptx.ShapeType.ellipse,
  };
}

function addBackground(pptx: any, slide: any, variant: "cover" | "content" = "content") {
  const S = createPptShapeTypes(pptx);
  slide.background = { color: C.ink };
  slide.addShape(S.rect, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: C.ink }, line: { color: C.ink } });
  slide.addShape(S.rect, { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: variant === "cover" ? C.navy : C.ink, transparency: variant === "cover" ? 0 : 8 }, line: { color: C.ink, transparency: 100 } });
  slide.addShape(S.oval, { x: 8.8, y: -1.15, w: 5.0, h: 5.0, fill: { color: C.green, transparency: 87 }, line: { color: C.green, transparency: 100 } });
  slide.addShape(S.oval, { x: -1.55, y: 4.55, w: 4.2, h: 4.2, fill: { color: C.blue, transparency: 91 }, line: { color: C.blue, transparency: 100 } });
  slide.addShape(S.rect, { x: 0.55, y: 0.28, w: 1.18, h: 0.045, fill: { color: C.green }, line: { color: C.green } });
  slide.addShape(S.rect, { x: 1.83, y: 0.28, w: 0.44, h: 0.045, fill: { color: C.cyan }, line: { color: C.cyan } });
}

function addFooter(pptx: any, slide: any, page: number) {
  const S = createPptShapeTypes(pptx);
  slide.addShape(S.line, { x: 0.55, y: 6.95, w: 12.2, h: 0, line: { color: C.line, transparency: 35, width: 0.6 } });
  slide.addText("MGP · Pricing Intelligence Courier", { x: 0.55, y: 7.09, w: 4.2, h: 0.18, fontFace: FONT.body, fontSize: 7, color: C.dim, margin: 0 });
  slide.addText(String(page).padStart(2, "0"), { x: 12.05, y: 7.04, w: 0.72, h: 0.25, fontFace: FONT.body, fontSize: 8.5, bold: true, color: C.green, align: "right", margin: 0 });
}

function addPageTitle(slide: any, eyebrow: string, title: string, subtitle?: string) {
  slide.addText(eyebrow.toUpperCase(), { x: 0.6, y: 0.48, w: 5.8, h: 0.22, fontFace: FONT.body, fontSize: 7.5, bold: true, color: C.green, charSpace: 1.35, margin: 0, fit: "shrink" });
  slide.addText(title, { x: 0.6, y: 0.82, w: 9.2, h: 0.48, fontFace: FONT.head, fontSize: 24, bold: true, color: C.text, margin: 0, fit: "shrink" });
  if (subtitle) slide.addText(subtitle, { x: 0.6, y: 1.34, w: 9.2, h: 0.34, fontFace: FONT.body, fontSize: 9.3, color: C.muted, margin: 0, fit: "shrink" });
}

function pill(slide: any, pptx: any, text: string, x: number, y: number, w: number, accent = C.green) {
  const S = createPptShapeTypes(pptx);
  slide.addShape(S.roundRect, { x, y, w, h: 0.3, fill: { color: accent, transparency: 88 }, line: { color: accent, transparency: 40 } });
  slide.addText(text.toUpperCase(), { x: x + 0.12, y: y + 0.085, w: w - 0.24, h: 0.1, fontFace: FONT.body, fontSize: 6.2, bold: true, color: accent, charSpace: 0.6, margin: 0, fit: "shrink" });
}

function statCard(pptx: any, slide: any, x: number, y: number, w: number, h: number, label: string, value: string, note?: string, accent = C.green) {
  const S = createPptShapeTypes(pptx);
  slide.addShape(S.roundRect, { x, y, w, h, fill: { color: C.panel, transparency: 0 }, line: { color: C.line, transparency: 8, width: 0.8 } });
  slide.addShape(S.rect, { x, y, w: 0.06, h, fill: { color: accent }, line: { color: accent } });
  slide.addText(label.toUpperCase(), { x: x + 0.22, y: y + 0.18, w: w - 0.38, h: 0.16, fontFace: FONT.body, fontSize: 6.4, bold: true, color: C.muted, charSpace: 0.65, margin: 0, fit: "shrink" });
  slide.addText(value, { x: x + 0.22, y: y + 0.48, w: w - 0.36, h: 0.4, fontFace: FONT.head, fontSize: 18.8, bold: true, color: accent, margin: 0, fit: "shrink" });
  if (note) slide.addText(note, { x: x + 0.22, y: y + 0.96, w: w - 0.36, h: 0.36, fontFace: FONT.body, fontSize: 7.4, color: C.muted, margin: 0, fit: "shrink" });
}

function narrativeBox(pptx: any, slide: any, x: number, y: number, w: number, h: number, title: string, body: string, accent = C.green) {
  const S = createPptShapeTypes(pptx);
  slide.addShape(S.roundRect, { x, y, w, h, fill: { color: C.panel3, transparency: 0 }, line: { color: C.line, transparency: 15 } });
  slide.addText(title, { x: x + 0.22, y: y + 0.2, w: w - 0.44, h: 0.24, fontFace: FONT.body, fontSize: 9.5, bold: true, color: accent, margin: 0, fit: "shrink" });
  slide.addText(body, { x: x + 0.22, y: y + 0.55, w: w - 0.44, h: h - 0.72, fontFace: FONT.body, fontSize: 8.3, color: C.muted, breakLine: false, margin: 0.02, fit: "shrink" });
}

function barsInPanel(pptx: any, slide: any, x: number, y: number, w: number, h: number, title: string, rows: DecisionRow[]) {
  const S = createPptShapeTypes(pptx);
  slide.addShape(S.roundRect, { x, y, w, h, fill: { color: C.panel, transparency: 2 }, line: { color: C.line, transparency: 8 } });
  slide.addText(title, { x: x + 0.18, y: y + 0.2, w: w - 0.36, h: 0.22, fontFace: FONT.head, fontSize: 14, bold: true, color: C.text, margin: 0, fit: "shrink" });
  const maxPrice = Math.max(...rows.map((r) => r.price), 1);
  const leader = rows[0];
  rows.slice(0, 5).forEach((row, idx) => {
    const rowY = y + 0.68 + idx * 0.63;
    const isCx = row.company === "Chilexpress";
    const premium = leader?.price ? (row.price / leader.price - 1) * 100 : 0;
    const color = isCx ? C.green : idx === 0 ? C.cyan : C.line2;
    slide.addText(`${idx + 1}. ${row.label}`, { x: x + 0.22, y: rowY, w: 1.92, h: 0.16, fontFace: FONT.body, fontSize: 7.4, bold: isCx || idx === 0, color: isCx ? C.green : C.text, margin: 0, fit: "shrink" });
    slide.addText(fmtMoney(row.price), { x: x + w - 1.22, y: rowY, w: 1.0, h: 0.16, fontFace: FONT.body, fontSize: 7.2, bold: true, color: C.text, align: "right", margin: 0, fit: "shrink" });
    slide.addShape(S.roundRect, { x: x + 0.22, y: rowY + 0.25, w: w - 0.44, h: 0.12, fill: { color: "1B2B3C" }, line: { color: "1B2B3C" } });
    slide.addShape(S.roundRect, { x: x + 0.22, y: rowY + 0.25, w: Math.max(0.18, (w - 0.44) * (row.price / maxPrice)), h: 0.12, fill: { color }, line: { color } });
    slide.addText(idx === 0 ? "Líder" : `+${fmtPct(premium)} vs líder`, { x: x + 0.22, y: rowY + 0.42, w: w - 0.44, h: 0.12, fontFace: FONT.body, fontSize: 5.9, color: idx === 0 ? C.cyan : C.dim, margin: 0, fit: "shrink" });
  });
}

function opportunityCard(pptx: any, slide: any, item: ReturnType<typeof enrich>[number], x: number, y: number, w: number, h: number) {
  const S = createPptShapeTypes(pptx);
  const accent = item.score >= 80 ? C.red : item.score >= 55 ? C.yellow : C.green;
  slide.addShape(S.roundRect, { x, y, w, h, fill: { color: C.panel, transparency: 0 }, line: { color: accent, transparency: 35, width: 1.2 } });
  slide.addText(item.zone, { x: x + 0.22, y: y + 0.2, w: 1.5, h: 0.26, fontFace: FONT.head, fontSize: 17, bold: true, color: C.text, margin: 0 });
  slide.addText(`${item.score}/100`, { x: x + w - 1.26, y: y + 0.2, w: 1.02, h: 0.24, fontFace: FONT.head, fontSize: 16, bold: true, color: accent, align: "right", margin: 0 });
  slide.addShape(S.roundRect, { x: x + 0.22, y: y + 0.68, w: w - 0.44, h: 0.1, fill: { color: "1C2B3B" }, line: { color: "1C2B3B" } });
  slide.addShape(S.roundRect, { x: x + 0.22, y: y + 0.68, w: (w - 0.44) * clamp(item.score, 0, 100) / 100, h: 0.1, fill: { color: accent }, line: { color: accent } });
  slide.addText("Chilexpress", { x: x + 0.22, y: y + 1.04, w: 1.3, h: 0.14, fontSize: 6.7, bold: true, color: C.dim, margin: 0 });
  slide.addText(item.chilexpress ? fmtMoney(item.chilexpress.price) : "—", { x: x + 1.55, y: y + 1.0, w: 1.3, h: 0.22, fontSize: 10, bold: true, color: C.text, align: "right", margin: 0, fit: "shrink" });
  slide.addText("Líder", { x: x + 0.22, y: y + 1.37, w: 1.0, h: 0.14, fontSize: 6.7, bold: true, color: C.dim, margin: 0 });
  slide.addText(item.leader ? `${item.leader.label} · ${fmtMoney(item.leader.price)}` : "—", { x: x + 1.0, y: y + 1.33, w: w - 1.22, h: 0.22, fontSize: 8.2, bold: true, color: C.text, align: "right", margin: 0, fit: "shrink" });
  slide.addText("Premium", { x: x + 0.22, y: y + 1.72, w: 1.0, h: 0.14, fontSize: 6.7, bold: true, color: C.dim, margin: 0 });
  slide.addText(item.premium == null ? "—" : `+${fmtPct(item.premium)}`, { x: x + 1.35, y: y + 1.68, w: 1.45, h: 0.22, fontSize: 10.5, bold: true, color: accent, align: "right", margin: 0 });
  pill(slide, pptx, item.action, x + 0.22, y + h - 0.5, w - 0.44, accent);
}

function addMiniMatrix(pptx: any, slide: any, x: number, y: number, w: number, h: number, items: ReturnType<typeof enrich>) {
  const S = createPptShapeTypes(pptx);
  slide.addShape(S.roundRect, { x, y, w, h, fill: { color: C.panel, transparency: 0 }, line: { color: C.line, transparency: 8 } });
  slide.addText("Matriz de posición", { x: x + 0.22, y: y + 0.2, w: w - 0.44, h: 0.2, fontFace: FONT.head, fontSize: 13, bold: true, color: C.text, margin: 0 });
  const maxScore = Math.max(...items.map((i) => i.score), 1);
  items.forEach((item, idx) => {
    const yy = y + 0.67 + idx * 0.64;
    slide.addText(item.zone, { x: x + 0.22, y: yy, w: 0.9, h: 0.17, fontFace: FONT.body, fontSize: 8, bold: true, color: C.text, margin: 0 });
    slide.addText(item.action, { x: x + 1.05, y: yy, w: 1.5, h: 0.17, fontFace: FONT.body, fontSize: 6.6, color: C.muted, margin: 0, fit: "shrink" });
    slide.addShape(S.roundRect, { x: x + 2.65, y: yy + 0.02, w: w - 3.35, h: 0.12, fill: { color: "1B2B3C" }, line: { color: "1B2B3C" } });
    slide.addShape(S.roundRect, { x: x + 2.65, y: yy + 0.02, w: (w - 3.35) * item.score / maxScore, h: 0.12, fill: { color: item.score >= 80 ? C.red : item.score >= 55 ? C.yellow : C.green }, line: { color: item.score >= 80 ? C.red : item.score >= 55 ? C.yellow : C.green } });
    slide.addText(`${item.score}`, { x: x + w - 0.55, y: yy - 0.02, w: 0.35, h: 0.16, fontFace: FONT.body, fontSize: 7.4, bold: true, color: C.text, align: "right", margin: 0 });
  });
}

function bullet(slide: any, text: string, x: number, y: number, w: number, accent = C.green) {
  slide.addText([{ text: "• ", options: { color: accent, bold: true } }, { text, options: { color: C.muted } }], { x, y, w, h: 0.34, fontFace: FONT.body, fontSize: 9.1, breakLine: false, margin: 0, fit: "shrink" });
}

export async function POST(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const zones = cleanZones(body?.zones);
    const selectedMonth = String(body?.selectedMonth ?? "").slice(0, 7) || "2026-09";
    const scenario = (body?.scenario ?? {}) as Scenario;
    const items = enrich(zones).filter((zone) => zone.rows.length);

    if (!items.length) return Response.json({ error: "No hay data suficiente para generar la presentación." }, { status: 400 });

    const { default: pptxgen } = await import("pptxgenjs");
    const pptx: any = new pptxgen();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "MGP Pricing Intelligence";
    pptx.company = "MGP";
    pptx.subject = "Executive pricing intelligence for Chilexpress";
    pptx.title = `Pricing Intelligence Chilexpress · ${monthLabel(selectedMonth)}`;
    pptx.lang = "es-CL";
    pptx.theme = { headFontFace: FONT.head, bodyFontFace: FONT.body, lang: "es-CL" };
    pptx.defineLayout({ name: "CUSTOM_WIDE", width: SLIDE_W, height: SLIDE_H });
    pptx.layout = "CUSTOM_WIDE";

    const mostPremium = [...items].sort((a, b) => (b.premium ?? -Infinity) - (a.premium ?? -Infinity))[0];
    const mostCompetitive = [...items].sort((a, b) => (a.premium ?? Infinity) - (b.premium ?? Infinity))[0];
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
    const recDelta = currentPrice && recMid ? (recMid / currentPrice - 1) * 100 : 0;

    let page = 1;

    // 1. Cover
    const s1 = pptx.addSlide();
    addBackground(pptx, s1, "cover");
    const S = createPptShapeTypes(pptx);
    s1.addShape(S.roundRect, { x: 0.62, y: 0.65, w: 2.25, h: 0.35, fill: { color: C.green, transparency: 88 }, line: { color: C.green, transparency: 38 } });
    s1.addText("CHILEXPRESS · DEMO", { x: 0.79, y: 0.78, w: 1.9, h: 0.08, fontFace: FONT.body, fontSize: 6.5, bold: true, color: C.green, charSpace: 1.2, margin: 0, fit: "shrink" });
    s1.addText("Pricing\nIntelligence\nCourier B2B", { x: 0.66, y: 1.34, w: 6.3, h: 1.85, fontFace: FONT.head, fontSize: 37, bold: true, color: C.text, margin: 0, breakLine: false, fit: "shrink" });
    s1.addText(`Reporte ejecutivo · ${monthLabel(selectedMonth)}`, { x: 0.7, y: 3.52, w: 4.8, h: 0.25, fontFace: FONT.body, fontSize: 11.5, color: C.muted, margin: 0 });
    s1.addShape(S.roundRect, { x: 7.65, y: 0.82, w: 4.95, h: 5.28, fill: { color: C.panel, transparency: 0 }, line: { color: C.line, transparency: 10 } });
    s1.addText("Resumen automático", { x: 8.02, y: 1.18, w: 3.7, h: 0.24, fontFace: FONT.head, fontSize: 15, bold: true, color: C.text, margin: 0 });
    statCard(pptx, s1, 8.02, 1.72, 1.95, 1.12, "Prioridad", highestScore?.zone ?? "—", `${highestScore?.score ?? 0}/100`, C.green);
    statCard(pptx, s1, 10.22, 1.72, 1.95, 1.12, "Mayor brecha", mostPremium?.zone ?? "—", mostPremium?.premium != null ? `+${fmtPct(mostPremium.premium)}` : "—", C.yellow);
    statCard(pptx, s1, 8.02, 3.08, 1.95, 1.12, "Más competitivo", mostCompetitive?.zone ?? "—", mostCompetitive?.premium != null ? `+${fmtPct(mostCompetitive.premium)}` : "—", C.cyan);
    statCard(pptx, s1, 10.22, 3.08, 1.95, 1.12, "Acción", highestScore?.action ?? "—", "recomendado", C.green);
    narrativeBox(pptx, s1, 8.02, 4.47, 4.15, 0.9, "Tesis de trabajo", "Pasar de lectura de precios a decisiones de pricing por zona: priorización, simulación económica y rango de test.", C.green);
    s1.addText("MGP", { x: 0.68, y: 6.54, w: 0.7, h: 0.2, fontFace: FONT.head, fontSize: 12, bold: true, color: C.text, margin: 0 });
    s1.addText("Marketing Growth Partners", { x: 1.38, y: 6.61, w: 2.4, h: 0.12, fontFace: FONT.body, fontSize: 7.2, color: C.dim, margin: 0 });
    addFooter(pptx, s1, page++);

    // 2. Executive summary
    const s2 = pptx.addSlide();
    addBackground(pptx, s2);
    addPageTitle(s2, "Executive summary", "Lo que debería mirar Pricing", "Tres señales accionables para convertir el benchmark en agenda comercial.");
    statCard(pptx, s2, 0.62, 1.85, 3.75, 1.35, "Zona prioritaria", highestScore?.zone ?? "—", `${highestScore?.action ?? "—"} · score ${highestScore?.score ?? 0}/100`, C.green);
    statCard(pptx, s2, 4.78, 1.85, 3.75, 1.35, "Brecha más exigente", mostPremium?.zone ?? "—", mostPremium?.premium != null ? `Chilexpress +${fmtPct(mostPremium.premium)} vs líder` : "Sin comparación", C.yellow);
    statCard(pptx, s2, 8.94, 1.85, 3.75, 1.35, "Competidor presión", mostPremium?.leader?.label ?? "—", mostPremium?.leader ? `${fmtMoney(mostPremium.leader.price)} en ${mostPremium.zone}` : "Sin data", C.cyan);
    narrativeBox(pptx, s2, 0.62, 3.72, 5.85, 1.45, "Lectura ejecutiva", `La mayor oportunidad está en ${highestScore?.zone ?? "—"}. El análisis sugiere evitar una rebaja general y probar descuentos segmentados por zona, recurrencia y volumen.`, C.green);
    narrativeBox(pptx, s2, 6.82, 3.72, 5.85, 1.45, "Decisión recomendada", `Usar un piloto controlado en ${selected?.zone ?? "—"}: medir conversión, retención y contribución antes de modificar la tarifa base.`, C.yellow);
    bullet(s2, "La ausencia de datos futuros no se interpreta como precio cero; sólo se muestran censos comparables.", 0.72, 5.62, 6.1, C.green);
    bullet(s2, "Los márgenes de competencia son simulados; los precios sí provienen del benchmark cargado.", 6.9, 5.62, 5.7, C.cyan);
    addFooter(pptx, s2, page++);

    // 3. Market ranking
    const s3 = pptx.addSlide();
    addBackground(pptx, s3);
    addPageTitle(s3, "Benchmark competitivo", "Ranking de precios por macrozona", "Paquete ≤ 0,5 kg · origen Santiago · entrega a domicilio · tarifas Pyme/Empresa.");
    items.forEach((item, idx) => barsInPanel(pptx, s3, 0.62 + idx * 4.23, 1.82, 3.78, 3.75, item.zone, item.rows));
    narrativeBox(pptx, s3, 0.62, 5.9, 12.05, 0.72, "Cómo leer la lámina", "Las barras comparan precio promedio censado dentro de cada zona. Chilexpress aparece destacado; el líder es el menor precio comparable de la zona.", C.green);
    addFooter(pptx, s3, page++);

    // 4. Opportunity map
    const s4 = pptx.addSlide();
    addBackground(pptx, s4);
    addPageTitle(s4, "Mapa de oportunidades", "Dónde actuar primero", "El score combina brecha de precio y confianza del benchmark para priorizar zonas.");
    items.forEach((item, idx) => opportunityCard(pptx, s4, item, 0.62 + idx * 4.18, 1.72, 3.72, 2.86));
    addMiniMatrix(pptx, s4, 0.62, 5.08, 5.8, 1.15, items);
    narrativeBox(pptx, s4, 6.72, 5.08, 5.95, 1.15, "Implicancia para Chilexpress", `La oportunidad principal no es “igualar al más barato”, sino diseñar un tier de test donde la brecha sea alta y la conversión pueda reaccionar.`, C.yellow);
    addFooter(pptx, s4, page++);

    // 5. Scenario
    const s5 = pptx.addSlide();
    addBackground(pptx, s5);
    addPageTitle(s5, "Simulación de impacto", "Precio, volumen y contribución", "Escenario editable exportado desde la pestaña Decisiones.");
    statCard(pptx, s5, 0.62, 1.8, 2.75, 1.18, "Zona modelada", selected?.zone ?? "—", selected?.action ?? "—", C.green);
    statCard(pptx, s5, 3.68, 1.8, 2.75, 1.18, "Precio actual", currentPrice ? fmtMoney(currentPrice) : "—", `Líder: ${leaderPrice ? fmtMoney(leaderPrice) : "—"}`, C.text);
    statCard(pptx, s5, 6.74, 1.8, 2.75, 1.18, "Nuevo precio", newPrice ? fmtMoney(newPrice) : "—", `${priceChange > 0 ? "+" : ""}${fmtPct(priceChange)} vs actual`, C.cyan);
    statCard(pptx, s5, 9.8, 1.8, 2.75, 1.18, "Volumen", fmtNum(newVolume), `${volumeChange > 0 ? "+" : ""}${fmtPct(volumeChange)} supuesto`, C.yellow);
    narrativeBox(pptx, s5, 0.62, 3.45, 3.75, 1.25, "Ingresos", `${fmtMoney(currentRevenue)} actual → ${fmtMoney(newRevenue)} modelado. Variación: ${newRevenue >= currentRevenue ? "+" : ""}${fmtPct(currentRevenue ? (newRevenue / currentRevenue - 1) * 100 : 0)}.`, C.cyan);
    narrativeBox(pptx, s5, 4.78, 3.45, 3.75, 1.25, "Contribución", `${fmtMoney(currentContribution)} actual → ${fmtMoney(newContribution)} modelado. Variación: ${newContribution >= currentContribution ? "+" : ""}${fmtPct(currentContribution ? (newContribution / currentContribution - 1) * 100 : 0)}.`, C.green);
    narrativeBox(pptx, s5, 8.94, 3.45, 3.75, 1.25, "Margen", `${fmtPct(currentMargin)} actual → ${fmtPct(newMargin)} modelado. Costo supuesto: ${fmtPct(costShare)} del precio actual.`, C.yellow);
    bullet(s5, "La simulación mantiene costo unitario constante; sirve para discusión de negocio, no para estimar elasticidad real.", 0.72, 5.45, 11.6, C.green);
    addFooter(pptx, s5, page++);

    // 6. Recommended test range
    const s6 = pptx.addSlide();
    addBackground(pptx, s6);
    addPageTitle(s6, "Precio recomendado", "Rango de test, no precio óptimo", "El rango combina líder competitivo, costo supuesto y margen mínimo objetivo.");
    s6.addShape(S.roundRect, { x: 0.78, y: 1.72, w: 11.78, h: 2.35, fill: { color: C.panel, transparency: 0 }, line: { color: C.green, transparency: 45 } });
    s6.addText("Rango recomendado para test", { x: 1.08, y: 2.1, w: 4.2, h: 0.22, fontFace: FONT.body, fontSize: 8, bold: true, color: C.green, charSpace: 1, margin: 0 });
    s6.addText(recLow && recHigh ? `${fmtMoney(recLow)} – ${fmtMoney(recHigh)}` : "Sin data comparable", { x: 1.08, y: 2.48, w: 6.8, h: 0.55, fontFace: FONT.head, fontSize: 30, bold: true, color: C.text, margin: 0, fit: "shrink" });
    s6.addText(recMid ? `Punto medio sugerido: ${fmtMoney(recMid)} · ajuste vs actual: ${recDelta > 0 ? "+" : ""}${fmtPct(recDelta)}` : "Requiere Chilexpress + líder comparable", { x: 1.1, y: 3.25, w: 7.2, h: 0.24, fontFace: FONT.body, fontSize: 10.3, color: C.muted, margin: 0, fit: "shrink" });
    statCard(pptx, s6, 8.6, 2.02, 1.68, 0.96, "Actual", currentPrice ? fmtMoney(currentPrice) : "—", selected?.zone ?? "—", C.text);
    statCard(pptx, s6, 10.55, 2.02, 1.68, 0.96, "Piso margen", floorPrice ? fmtMoney(floorPrice) : "—", `${fmtPct(targetMargin)} objetivo`, C.green);
    narrativeBox(pptx, s6, 0.72, 4.72, 3.7, 1.2, "1. Test comercial", "Activar oferta controlada por zona y volumen, sin tocar la tarifa base general.", C.green);
    narrativeBox(pptx, s6, 4.82, 4.72, 3.7, 1.2, "2. Medición", "Comparar conversión, retención y contribución contra grupo control de tarifa actual.", C.cyan);
    narrativeBox(pptx, s6, 8.92, 4.72, 3.7, 1.2, "3. Escalamiento", "Escalar sólo donde el lift comercial compense la pérdida de precio unitario.", C.yellow);
    addFooter(pptx, s6, page++);

    // 7. Methodology
    const s7 = pptx.addSlide();
    addBackground(pptx, s7);
    addPageTitle(s7, "Metodología", "Qué está dentro y qué no", "Criterios para que el análisis sea defendible frente a Pricing y Finanzas.");
    narrativeBox(pptx, s7, 0.62, 1.82, 3.85, 1.35, "Perfil comparable", "Origen Santiago, paquete ≤ 0,5 kg, entrega a domicilio y tarifa Pyme/Empresa. No se mezclan tarifas punto/sucursal con domicilio.", C.green);
    narrativeBox(pptx, s7, 4.72, 1.82, 3.85, 1.35, "Tratamiento de data", "Se calcula precio promedio robusto ponderado por confianza. Meses sin observación quedan vacíos; nunca se imputan como $0.", C.cyan);
    narrativeBox(pptx, s7, 8.82, 1.82, 3.85, 1.35, "Costos y márgenes", "Los márgenes de competencia son supuestos editables del simulador. Para precisión final se requieren costos reales de Chilexpress.", C.yellow);
    s7.addShape(S.roundRect, { x: 0.62, y: 3.78, w: 12.05, h: 1.45, fill: { color: C.panel, transparency: 0 }, line: { color: C.line, transparency: 12 } });
    s7.addText("Próximo paso sugerido", { x: 0.92, y: 4.08, w: 3.0, h: 0.22, fontFace: FONT.head, fontSize: 15, bold: true, color: C.text, margin: 0 });
    s7.addText("Conectar costos reales, conversión por segmento Pyme y resultados de campañas para transformar el rango de test en una recomendación econométrica.", { x: 3.65, y: 4.1, w: 8.55, h: 0.32, fontFace: FONT.body, fontSize: 10, color: C.muted, margin: 0, fit: "shrink" });
    bullet(s7, "Este deck se genera automáticamente desde la pestaña Decisiones con la data visible del dashboard.", 0.75, 5.72, 11.5, C.green);
    addFooter(pptx, s7, page++);

    const output = await pptx.write({ outputType: "nodebuffer" });
    const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);

    return new Response(buffer, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "content-disposition": `attachment; filename="chilexpress-pricing-intelligence-${selectedMonth.replace("-", "")}.pptx"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("executive_ppt_error", error);
    return Response.json({ error: "No fue posible generar la presentación ejecutiva." }, { status: 500 });
  }
}
