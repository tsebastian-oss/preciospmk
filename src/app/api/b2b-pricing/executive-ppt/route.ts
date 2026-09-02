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

type DecisionZone = {
  zone: ZoneName;
  rows: DecisionRow[];
};

type Scenario = {
  selectedZone?: string;
  monthlyVolume?: number;
  priceChange?: number;
  volumeChange?: number;
  costShare?: number;
  targetMargin?: number;
};

const COLORS = {
  bg: "07111F",
  panel: "0D1928",
  panel2: "112337",
  line: "213348",
  text: "F2F7FB",
  muted: "9EB0C2",
  green: "7DD3A8",
  blue: "74B3FF",
  yellow: "FACC6B",
  red: "FB7185",
  white: "FFFFFF",
};

function money(value: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value || 0);
}

function pct(value: number) {
  return `${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value || 0)}%`;
}

function monthLabel(key: string) {
  const parsed = new Date(`${key}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  const label = new Intl.DateTimeFormat("es-CL", { month: "long" }).format(parsed);
  return `${label.charAt(0).toUpperCase() + label.slice(1)} 2026`;
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
        .filter((row: DecisionRow) => row.company && row.price > 0)
        .sort((a: DecisionRow, b: DecisionRow) => a.price - b.price),
    }));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function enrich(zones: DecisionZone[]) {
  return zones.map((zone) => {
    const rows = [...zone.rows].sort((a, b) => a.price - b.price);
    const leader = rows[0] ?? null;
    const chilexpress = rows.find((row) => row.company === "Chilexpress") ?? null;
    const premium = leader && chilexpress && leader.price > 0 ? (chilexpress.price / leader.price - 1) * 100 : null;
    const score = Math.round(clamp((premium ?? 0) / 3.5, 0, 100) * 0.8 + (chilexpress?.confidence ?? 0) * 0.2);
    const action = premium == null ? "Completar evidencia" : premium >= 100 ? "Crear tier / test" : premium >= 45 ? "Ajustar selectivamente" : premium >= 15 ? "Validar elasticidad" : "Defender posición";
    return { ...zone, rows, leader, chilexpress, premium, score, action };
  });
}

function addBg(pptx: any, slide: any) {
  slide.background = { color: COLORS.bg };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: COLORS.bg }, line: { color: COLORS.bg } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.1, fill: { color: COLORS.green }, line: { color: COLORS.green }, transparency: 8 });
}

function addFooter(slide: any, page: number) {
  slide.addText("MGP · Pricing Intelligence Courier", { x: 0.55, y: 7.08, w: 4.4, h: 0.18, fontFace: "Aptos", fontSize: 7, color: COLORS.muted, margin: 0 });
  slide.addText(String(page).padStart(2, "0"), { x: 12.15, y: 7.02, w: 0.7, h: 0.25, fontFace: "Aptos", fontSize: 8, bold: true, color: COLORS.green, align: "right", margin: 0 });
}

function addTitle(slide: any, eyebrow: string, title: string, subtitle?: string) {
  slide.addText(eyebrow.toUpperCase(), { x: 0.55, y: 0.42, w: 5.8, h: 0.22, fontFace: "Aptos", fontSize: 7.5, bold: true, color: COLORS.green, charSpace: 1.3, margin: 0 });
  slide.addText(title, { x: 0.55, y: 0.75, w: 8.8, h: 0.46, fontFace: "Aptos Display", fontSize: 24, bold: true, color: COLORS.text, margin: 0, breakLine: false });
  if (subtitle) slide.addText(subtitle, { x: 0.55, y: 1.23, w: 8.8, h: 0.35, fontFace: "Aptos", fontSize: 9.5, color: COLORS.muted, margin: 0, breakLine: false });
}

function addCard(pptx: any, slide: any, x: number, y: number, w: number, h: number, title: string, value: string, note?: string, color = COLORS.text) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: COLORS.panel }, line: { color: COLORS.line, transparency: 10 } });
  slide.addText(title.toUpperCase(), { x: x + 0.18, y: y + 0.15, w: w - 0.36, h: 0.18, fontFace: "Aptos", fontSize: 6.7, bold: true, color: COLORS.muted, charSpace: 0.5, margin: 0 });
  slide.addText(value, { x: x + 0.18, y: y + 0.46, w: w - 0.36, h: 0.36, fontFace: "Aptos Display", fontSize: 18, bold: true, color, margin: 0, fit: "shrink" });
  if (note) slide.addText(note, { x: x + 0.18, y: y + 0.93, w: w - 0.36, h: 0.35, fontFace: "Aptos", fontSize: 7.3, color: COLORS.muted, margin: 0, fit: "shrink" });
}

function addBar(slide: any, x: number, y: number, w: number, label: string, value: string, widthPct: number, isChilexpress: boolean) {
  slide.addText(label, { x, y, w: 2.25, h: 0.18, fontFace: "Aptos", fontSize: 7.7, bold: isChilexpress, color: isChilexpress ? COLORS.green : COLORS.text, margin: 0, fit: "shrink" });
  slide.addText(value, { x: x + 2.35, y, w: 1.0, h: 0.18, fontFace: "Aptos", fontSize: 7.5, bold: true, color: COLORS.text, align: "right", margin: 0 });
  slide.addShape("rect", { x, y: y + 0.28, w, h: 0.08, fill: { color: "1B2A3A" }, line: { color: "1B2A3A" } });
  slide.addShape("rect", { x, y: y + 0.28, w: Math.max(0.18, w * widthPct), h: 0.08, fill: { color: isChilexpress ? COLORS.green : COLORS.blue }, line: { color: isChilexpress ? COLORS.green : COLORS.blue } });
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

    if (!items.length) {
      return Response.json({ error: "No hay data suficiente para generar la presentación." }, { status: 400 });
    }

    const { default: pptxgen } = await import("pptxgenjs");
    const pptx: any = new pptxgen();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "MGP Pricing Intelligence";
    pptx.company = "MGP";
    pptx.subject = "Executive pricing intelligence for Chilexpress";
    pptx.title = `Pricing Intelligence Chilexpress · ${monthLabel(selectedMonth)}`;
    pptx.lang = "es-CL";
    pptx.theme = {
      headFontFace: "Aptos Display",
      bodyFontFace: "Aptos",
      lang: "es-CL",
    };

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
    const currentContribution = (currentPrice - unitCost) * monthlyVolume;
    const newContribution = (newPrice - unitCost) * newVolume;
    const floorPrice = unitCost / (1 - clamp(targetMargin, 1, 80) / 100);
    const recLow = leaderPrice > 0 && currentPrice > 0 ? Math.round(Math.max(floorPrice, leaderPrice * 1.1)) : 0;
    const recHigh = leaderPrice > 0 && currentPrice > 0 ? Math.round(Math.max(recLow, Math.min(currentPrice * 0.92, leaderPrice * 1.6))) : 0;

    let page = 1;

    const s1 = pptx.addSlide();
    addBg(pptx, s1);
    s1.addText("CHILEXPRESS", { x: 0.65, y: 0.58, w: 2.1, h: 0.24, fontSize: 8, bold: true, color: COLORS.green, charSpace: 1.6, margin: 0 });
    s1.addText("Pricing Intelligence\nCourier B2B", { x: 0.65, y: 1.25, w: 7.1, h: 1.35, fontFace: "Aptos Display", fontSize: 34, bold: true, color: COLORS.text, margin: 0, breakLine: false, fit: "shrink" });
    s1.addText(`Reporte ejecutivo · ${monthLabel(selectedMonth)}`, { x: 0.68, y: 2.75, w: 5.4, h: 0.32, fontSize: 12, color: COLORS.muted, margin: 0 });
    s1.addShape(pptx.ShapeType.roundRect, { x: 8.15, y: 0.95, w: 3.95, h: 4.72, rectRadius: 0.12, fill: { color: COLORS.panel }, line: { color: COLORS.line } });
    addCard(pptx, s1, 8.45, 1.35, 3.35, 1.05, "Mayor oportunidad", `${highestScore?.zone ?? "—"}`, `${highestScore?.action ?? "Sin data"}`, COLORS.green);
    addCard(pptx, s1, 8.45, 2.65, 3.35, 1.05, "Mayor premium", `${mostPremium?.zone ?? "—"}`, mostPremium?.premium != null ? `+${pct(mostPremium.premium)} vs líder` : "Sin comparación", COLORS.yellow);
    addCard(pptx, s1, 8.45, 3.95, 3.35, 1.05, "Más competitivo", `${mostCompetitive?.zone ?? "—"}`, mostCompetitive?.premium != null ? `+${pct(mostCompetitive.premium)} vs líder` : "Sin comparación", COLORS.blue);
    s1.addText("MGP · Marketing Growth Partners", { x: 0.68, y: 6.6, w: 4.6, h: 0.22, fontSize: 8, color: COLORS.muted, margin: 0 });
    addFooter(s1, page++);

    const s2 = pptx.addSlide();
    addBg(pptx, s2);
    addTitle(s2, "Resumen ejecutivo", "Dónde actuar primero", "Lectura de oportunidad competitiva por macrozona B2B.");
    addCard(pptx, s2, 0.55, 1.8, 3.9, 1.35, "Prioridad", highestScore?.zone ?? "—", `${highestScore?.action ?? "Completar evidencia"} · score ${highestScore?.score ?? 0}/100`, COLORS.green);
    addCard(pptx, s2, 4.72, 1.8, 3.9, 1.35, "Brecha crítica", mostPremium?.zone ?? "—", mostPremium?.premium != null ? `Chilexpress +${pct(mostPremium.premium)} vs líder` : "Sin comparación", COLORS.yellow);
    addCard(pptx, s2, 8.9, 1.8, 3.9, 1.35, "Presión de precio", mostPremium?.leader?.label ?? "—", mostPremium?.leader ? `${money(mostPremium.leader.price)} en ${mostPremium.zone}` : "Sin líder", COLORS.blue);
    const bullets = [
      "El benchmark separa zonas Norte, Centro y Sur para evitar promedios nacionales que escondan brechas tácticas.",
      "La recomendación es testear descuentos segmentados, no hacer una rebaja generalizada de tarifa base.",
      "Los costos y márgenes deben usarse como simulación hasta conectar costos reales de Chilexpress.",
      "El siguiente paso comercial es elegir una zona piloto y medir conversión, volumen, contribución y retención.",
    ];
    bullets.forEach((text, i) => {
      s2.addShape(pptx.ShapeType.roundRect, { x: 0.75, y: 3.65 + i * 0.54, w: 11.9, h: 0.36, rectRadius: 0.05, fill: { color: COLORS.panel }, line: { color: COLORS.line, transparency: 40 } });
      s2.addText(text, { x: 0.95, y: 3.73 + i * 0.54, w: 11.4, h: 0.16, fontSize: 8.4, color: COLORS.text, margin: 0, fit: "shrink" });
    });
    addFooter(s2, page++);

    const s3 = pptx.addSlide();
    addBg(pptx, s3);
    addTitle(s3, "Benchmark competitivo", "Posicionamiento por macrozona", "Precio promedio comparable: origen Santiago, paquete ≤0,5 kg, entrega a domicilio.");
    items.forEach((zone, zi) => {
      const x = 0.55 + zi * 4.22;
      s3.addShape(pptx.ShapeType.roundRect, { x, y: 1.75, w: 3.85, h: 4.62, rectRadius: 0.09, fill: { color: COLORS.panel }, line: { color: COLORS.line } });
      s3.addText(zone.zone, { x: x + 0.25, y: 1.98, w: 1.8, h: 0.28, fontSize: 17, bold: true, color: COLORS.text, margin: 0 });
      s3.addText(zone.premium != null ? `Chilexpress +${pct(zone.premium)} vs líder` : "Sin comparación", { x: x + 0.25, y: 2.34, w: 3.25, h: 0.2, fontSize: 7.5, color: COLORS.muted, margin: 0 });
      const max = Math.max(...zone.rows.map((row) => row.price), 1);
      zone.rows.slice(0, 4).forEach((row, ri) => {
        addBar(s3, x + 0.25, 2.85 + ri * 0.72, 3.3, `${ri + 1}. ${row.label}`, money(row.price), row.price / max, row.company === "Chilexpress");
      });
      s3.addText(`Acción: ${zone.action}`, { x: x + 0.25, y: 5.98, w: 3.2, h: 0.2, fontSize: 7.5, bold: true, color: COLORS.green, margin: 0, fit: "shrink" });
    });
    addFooter(s3, page++);

    const s4 = pptx.addSlide();
    addBg(pptx, s4);
    addTitle(s4, "Mapa de oportunidades", "Score para decidir dónde actuar", "Score 0–100 basado en brecha de precio, cobertura y confianza del benchmark.");
    items.forEach((zone, i) => {
      const y = 1.75 + i * 1.5;
      s4.addText(zone.zone, { x: 0.75, y, w: 1.35, h: 0.26, fontSize: 15, bold: true, color: COLORS.text, margin: 0 });
      s4.addText(`${zone.score}/100`, { x: 2.22, y: y - 0.02, w: 0.9, h: 0.25, fontSize: 13, bold: true, color: COLORS.green, align: "right", margin: 0 });
      s4.addShape("rect", { x: 3.38, y: y + 0.06, w: 5.6, h: 0.12, fill: { color: "1B2A3A" }, line: { color: "1B2A3A" } });
      s4.addShape("rect", { x: 3.38, y: y + 0.06, w: Math.max(0.1, 5.6 * zone.score / 100), h: 0.12, fill: { color: COLORS.green }, line: { color: COLORS.green } });
      s4.addShape(pptx.ShapeType.roundRect, { x: 9.28, y: y - 0.13, w: 2.8, h: 0.5, rectRadius: 0.06, fill: { color: COLORS.panel }, line: { color: COLORS.line } });
      s4.addText(zone.action, { x: 9.45, y: y + 0.03, w: 2.45, h: 0.15, fontSize: 7.4, bold: true, color: COLORS.green, align: "center", margin: 0, fit: "shrink" });
      const detail = zone.chilexpress && zone.leader ? `Chilexpress ${money(zone.chilexpress.price)} · líder ${zone.leader.label} ${money(zone.leader.price)} · premium +${pct(zone.premium ?? 0)}` : "Falta data comparable para Chilexpress y líder.";
      s4.addText(detail, { x: 0.75, y: y + 0.5, w: 11.3, h: 0.18, fontSize: 8.2, color: COLORS.muted, margin: 0, fit: "shrink" });
    });
    addFooter(s4, page++);

    const s5 = pptx.addSlide();
    addBg(pptx, s5);
    addTitle(s5, "Simulación comercial", `Escenario de test · ${selected?.zone ?? "—"}`, "Impacto económico con supuestos editables de precio, volumen y costo unitario.");
    addCard(pptx, s5, 0.6, 1.75, 2.9, 1.2, "Precio actual", currentPrice ? money(currentPrice) : "—", "Chilexpress", COLORS.text);
    addCard(pptx, s5, 3.72, 1.75, 2.9, 1.2, "Nuevo precio", newPrice ? money(newPrice) : "—", `${priceChange > 0 ? "+" : ""}${priceChange}% vs actual`, COLORS.green);
    addCard(pptx, s5, 6.84, 1.75, 2.9, 1.2, "Nuevo volumen", `${Math.round(newVolume).toLocaleString("es-CL")}`, `${volumeChange > 0 ? "+" : ""}${volumeChange}% vs actual`, COLORS.blue);
    addCard(pptx, s5, 9.96, 1.75, 2.9, 1.2, "Contribución", money(newContribution), `${newContribution >= currentContribution ? "+" : ""}${pct(currentContribution ? (newContribution / currentContribution - 1) * 100 : 0)} vs actual`, COLORS.yellow);
    s5.addShape(pptx.ShapeType.roundRect, { x: 0.65, y: 3.55, w: 12.0, h: 1.1, rectRadius: 0.08, fill: { color: COLORS.panel }, line: { color: COLORS.line } });
    s5.addText("Lectura ejecutiva", { x: 0.9, y: 3.82, w: 2.2, h: 0.22, fontSize: 11, bold: true, color: COLORS.text, margin: 0 });
    s5.addText(`Con un ajuste de ${priceChange}% en precio y ${volumeChange}% de volumen, la contribución estimada pasa de ${money(currentContribution)} a ${money(newContribution)}. El supuesto de costo unitario usado es ${costShare}% del precio actual.`, { x: 3.1, y: 3.78, w: 9.1, h: 0.32, fontSize: 8.4, color: COLORS.muted, margin: 0, fit: "shrink" });
    addCard(pptx, s5, 0.65, 5.1, 5.8, 1.0, "Rango recomendado para test", recLow && recHigh ? `${money(recLow)} – ${money(recHigh)}` : "Sin data", `margen mínimo objetivo ${targetMargin}%`, COLORS.green);
    addCard(pptx, s5, 6.8, 5.1, 5.8, 1.0, "Líder competitivo", selected?.leader ? `${selected.leader.label}` : "—", selected?.leader ? `${money(selected.leader.price)} en ${selected.zone}` : "sin líder", COLORS.blue);
    addFooter(s5, page++);

    const s6 = pptx.addSlide();
    addBg(pptx, s6);
    addTitle(s6, "Próximos pasos", "Cómo llevarlo a decisión", "Acciones recomendadas para convertir el benchmark en aprendizaje comercial.");
    const steps = [
      ["1", "Elegir zona piloto", `Priorizar ${highestScore?.zone ?? "Norte"} por mayor oportunidad competitiva.`],
      ["2", "Definir tier de test", "Probar descuento segmentado por recurrencia/volumen sin tocar la tarifa base."],
      ["3", "Medir impacto", "Comparar conversión, volumen, contribución y retención contra grupo control."],
      ["4", "Conectar costos reales", "Reemplazar supuestos de costo-to-serve por datos operacionales de Chilexpress."],
    ];
    steps.forEach(([num, title, text], i) => {
      const y = 1.65 + i * 1.15;
      s6.addShape(pptx.ShapeType.ellipse, { x: 0.78, y: y - 0.05, w: 0.38, h: 0.38, fill: { color: COLORS.green }, line: { color: COLORS.green } });
      s6.addText(num, { x: 0.78, y: y + 0.05, w: 0.38, h: 0.12, fontSize: 7.5, bold: true, color: COLORS.bg, align: "center", margin: 0 });
      s6.addText(title, { x: 1.35, y, w: 3.5, h: 0.22, fontSize: 12.5, bold: true, color: COLORS.text, margin: 0 });
      s6.addText(text, { x: 4.7, y: y + 0.02, w: 7.1, h: 0.2, fontSize: 8.2, color: COLORS.muted, margin: 0, fit: "shrink" });
    });
    s6.addShape(pptx.ShapeType.roundRect, { x: 0.78, y: 6.35, w: 11.6, h: 0.4, rectRadius: 0.05, fill: { color: COLORS.panel }, line: { color: COLORS.line } });
    s6.addText("Nota: los precios son evidencia observada/oficial; márgenes y rangos son simulaciones hasta recibir costos reales.", { x: 1.0, y: 6.47, w: 11.2, h: 0.12, fontSize: 7.4, color: COLORS.muted, margin: 0, fit: "shrink" });
    addFooter(s6, page++);

    const arrayBuffer = await pptx.write({ outputType: "arraybuffer" }) as ArrayBuffer;
    const safeMonth = selectedMonth.replace("-", "");
    return new Response(arrayBuffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "content-disposition": `attachment; filename="chilexpress-pricing-intelligence-${safeMonth}.pptx"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("executive ppt error", error);
    return Response.json({ error: "No fue posible generar la presentación ejecutiva." }, { status: 500 });
  }
}
