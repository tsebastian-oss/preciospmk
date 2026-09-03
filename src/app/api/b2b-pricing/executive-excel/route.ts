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

type HistoryRow = {
  month: string;
  zone: ZoneName;
  company: string;
  priceClp: number;
  confidence: number;
  destinations: number;
  observations: number;
  channel: string;
  plan: string;
};

type Scenario = {
  selectedZone?: string;
  monthlyVolume?: number;
  priceChange?: number;
  volumeChange?: number;
  costShare?: number;
  targetMargin?: number;
};

const ZONES: ZoneName[] = ["Norte", "Centro", "Sur"];
const moneyFmt = '$#,##0;[Red]-$#,##0';
const pctFmt = '0.0%;[Red]-0.0%';
const integerFmt = '#,##0';

const C = {
  navy: "081827",
  navy2: "0D1F31",
  panel: "102942",
  green: "77D9A8",
  greenDark: "1F6B4C",
  blue: "447CFF",
  cyan: "6CB6FF",
  yellow: "FFD166",
  red: "FB7185",
  white: "FFFFFF",
  text: "EAF1F6",
  muted: "8FA3B5",
  border: "D8E2EA",
  soft: "F4F7F9",
  softGreen: "EAF8F1",
  softBlue: "EDF4FF",
  softYellow: "FFF7DC",
  input: "FFF2CC",
  formula: "E7F0FF",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cleanZones(value: unknown): DecisionZone[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((zone: any) => ZONES.includes(zone?.zone) && Array.isArray(zone?.rows))
    .map((zone: any) => ({
      zone: zone.zone as ZoneName,
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

function cleanHistory(value: unknown): HistoryRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row: any) => ({
      month: String(row?.month ?? "").slice(0, 7),
      zone: String(row?.zone ?? "") as ZoneName,
      company: String(row?.company ?? "").slice(0, 80),
      priceClp: Number(row?.priceClp ?? 0),
      confidence: Number(row?.confidence ?? 0),
      destinations: Number(row?.destinations ?? 0),
      observations: Number(row?.observations ?? 0),
      channel: String(row?.channel ?? "").slice(0, 60),
      plan: String(row?.plan ?? "").slice(0, 140),
    }))
    .filter((row: HistoryRow) => /^\d{4}-\d{2}$/.test(row.month) && ZONES.includes(row.zone) && row.company && row.priceClp > 0)
    .sort((a: HistoryRow, b: HistoryRow) =>
      a.month.localeCompare(b.month) || a.zone.localeCompare(b.zone, "es") || a.priceClp - b.priceClp
    );
}

function zoneMetrics(zones: DecisionZone[]) {
  return ZONES.map((zoneName) => {
    const zone = zones.find((item) => item.zone === zoneName);
    const rows = zone?.rows ?? [];
    const leader = rows[0] ?? null;
    const chilexpress = rows.find((row) => row.company === "Chilexpress") ?? null;
    const premium = leader && chilexpress && leader.price > 0 ? chilexpress.price / leader.price - 1 : null;
    const confidence = chilexpress?.confidence ?? 0;
    const score = premium == null ? 0 : Math.round(clamp((premium * 100) / 3.5, 0, 100) * 0.8 + confidence * 0.2);
    const action = premium == null
      ? "Completar evidencia"
      : premium >= 1
        ? "Crear tier / test"
        : premium >= 0.45
          ? "Ajustar selectivamente"
          : premium >= 0.15
            ? "Validar elasticidad"
            : "Defender posición";
    return { zone: zoneName, rows, leader, chilexpress, premium, confidence, score, action };
  });
}

function monthLong(key: string) {
  const date = new Date(`${key}-01T12:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  const label = new Intl.DateTimeFormat("es-CL", { month: "long", year: "numeric" }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function styleTitle(ws: any, title: string, subtitle: string, lastCol = 10) {
  ws.mergeCells(1, 1, 1, lastCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: "Aptos Display", size: 22, bold: true, color: { argb: C.white } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 34;

  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value = subtitle;
  sub.font = { name: "Aptos", size: 10, color: { argb: "C4D0DA" } };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
  sub.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  ws.getRow(2).height = 26;
}

function styleSection(cell: any) {
  cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: C.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.greenDark } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function headerRow(row: any) {
  row.height = 22;
  row.eachCell((cell: any) => {
    cell.font = { name: "Aptos", size: 9, bold: true, color: { argb: C.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy2 } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      bottom: { style: "thin", color: { argb: "2B4459" } },
      right: { style: "thin", color: { argb: "2B4459" } },
    };
  });
}

function thinGrid(cell: any) {
  cell.border = {
    bottom: { style: "hair", color: { argb: C.border } },
    right: { style: "hair", color: { argb: C.border } },
  };
}

export async function POST(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;

  try {
    const body = await request.json();
    const selectedMonth = String(body?.selectedMonth ?? "").slice(0, 7) || "2026-09";
    const zones = cleanZones(body?.zones);
    const history = cleanHistory(body?.history);
    const scenario = (body?.scenario ?? {}) as Scenario;

    if (!zones.some((zone) => zone.rows.length) && !history.length) {
      return Response.json({ error: "No hay data suficiente para generar el reporte Excel." }, { status: 400 });
    }

    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "MGP Super Precios";
    workbook.company = "MGP";
    workbook.title = `Chilexpress Pricing Intelligence · ${selectedMonth}`;
    workbook.subject = "Reporte ejecutivo B2B para directorio";
    workbook.category = "Pricing Intelligence";
    workbook.keywords = "pricing, courier, B2B, Chilexpress, MGP";
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;

    const metrics = zoneMetrics(zones);
    const validMetrics = metrics.filter((item) => item.premium != null);
    const mostPremium = [...validMetrics].sort((a, b) => (b.premium ?? -Infinity) - (a.premium ?? -Infinity))[0] ?? null;
    const topOpportunity = [...metrics].sort((a, b) => b.score - a.score)[0] ?? null;
    const selected = metrics.find((item) => item.zone === scenario.selectedZone) ?? topOpportunity ?? metrics[0];

    const monthlyVolume = Number(scenario.monthlyVolume ?? 5000);
    const priceChange = Number(scenario.priceChange ?? -10) / 100;
    const volumeChange = Number(scenario.volumeChange ?? 10) / 100;
    const costShare = Number(scenario.costShare ?? 60) / 100;
    const targetMargin = Number(scenario.targetMargin ?? 28) / 100;
    const currentPrice = selected?.chilexpress?.price ?? 0;
    const leaderPrice = selected?.leader?.price ?? 0;
    const unitCost = currentPrice * costShare;
    const newPrice = currentPrice * (1 + priceChange);
    const newVolume = monthlyVolume * (1 + volumeChange);
    const currentRevenue = currentPrice * monthlyVolume;
    const newRevenue = newPrice * newVolume;
    const currentContribution = (currentPrice - unitCost) * monthlyVolume;
    const newContribution = (newPrice - unitCost) * newVolume;
    const currentMargin = currentPrice ? (currentPrice - unitCost) / currentPrice : 0;
    const newMargin = newPrice ? (newPrice - unitCost) / newPrice : 0;
    const floorPrice = targetMargin < 1 ? unitCost / (1 - targetMargin) : 0;
    const recLow = leaderPrice && currentPrice ? Math.max(floorPrice, leaderPrice * 1.1) : 0;
    const recHigh = leaderPrice && currentPrice ? Math.max(recLow, Math.min(currentPrice * 0.92, leaderPrice * 1.6)) : 0;
    const recMid = recLow && recHigh ? (recLow + recHigh) / 2 : 0;
    const recDelta = currentPrice && recMid ? recMid / currentPrice - 1 : 0;

    // 1. Resumen Directorio
    const summary = workbook.addWorksheet("Resumen Directorio", {
      views: [{ state: "frozen", ySplit: 3 }],
      properties: { defaultRowHeight: 18 },
    });
    summary.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.3, right: 0.3, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 } };
    styleTitle(summary, "CHILEXPRESS · PRICING INTELLIGENCE B2B", `Reporte ejecutivo para Directorio · ${monthLong(selectedMonth)} · MGP Super Precios`, 10);
    summary.columns = [
      { width: 17 }, { width: 18 }, { width: 18 }, { width: 17 }, { width: 18 },
      { width: 17 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
    ];

    summary.getCell("A4").value = "Mes analizado";
    summary.getCell("B4").value = selectedMonth;
    summary.getCell("D4").value = "Perfil comparable";
    summary.mergeCells("E4:H4");
    summary.getCell("E4").value = "Santiago → macrozona · ≤0,5 kg · domicilio · Pyme/Empresa";
    ["A4","D4"].forEach((a) => { summary.getCell(a).font = { bold: true, color: { argb: C.muted } }; });
    summary.getCell("B4").font = { bold: true, color: { argb: C.greenDark } };

    const kpis = [
      ["A6","B6","Precio promedio Chilexpress", metrics.filter(m=>m.chilexpress).reduce((s,m)=>s+(m.chilexpress?.price??0),0)/Math.max(1,metrics.filter(m=>m.chilexpress).length), moneyFmt],
      ["D6","E6","Mayor premium vs líder", mostPremium?.premium ?? 0, pctFmt],
      ["G6","H6","Zona prioritaria", topOpportunity?.zone ?? "—", "General"],
      ["I6","J6","Confianza promedio", metrics.reduce((s,m)=>s+m.confidence,0)/Math.max(1,metrics.length)/100, pctFmt],
    ] as const;
    for (const [labelCell,valueCell,label,value,format] of kpis) {
      summary.getCell(labelCell).value = label;
      summary.getCell(labelCell).font = { size: 8, bold: true, color: { argb: C.muted } };
      summary.getCell(valueCell).value = value as any;
      summary.getCell(valueCell).font = { size: 16, bold: true, color: { argb: C.navy } };
      summary.getCell(valueCell).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.softGreen } };
      if (format !== "General") summary.getCell(valueCell).numFmt = format;
      summary.getCell(valueCell).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      summary.getRow(Number(valueCell.replace(/\D/g,""))).height = 28;
    }

    summary.mergeCells("A8:J8");
    summary.getCell("A8").value = "LECTURA EJECUTIVA";
    styleSection(summary.getCell("A8"));
    summary.mergeCells("A9:J9");
    const executiveSentence = mostPremium && mostPremium.leader
      ? `La principal brecha competitiva se concentra en ${mostPremium.zone}: Chilexpress presenta un premium de ${((mostPremium.premium ?? 0)*100).toFixed(1)}% frente a ${mostPremium.leader.label}. La recomendación es priorizar tests segmentados por zona, recurrencia y volumen antes de una modificación transversal de tarifa.`
      : "La cobertura actual no permite identificar una brecha competitiva completa en todas las macrozonas. Se recomienda completar evidencia antes de una decisión transversal.";
    summary.getCell("A9").value = executiveSentence;
    summary.getCell("A9").font = { size: 11, color: { argb: C.navy } };
    summary.getCell("A9").fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.softBlue } };
    summary.getCell("A9").alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    summary.getRow(9).height = 48;

    summary.getRow(11).values = ["Macrozona","Chilexpress","Líder precio","Empresa líder","Premium vs líder","Confianza CX","Score oportunidad","Acción","Cobertura CX","Canal CX"];
    headerRow(summary.getRow(11));
    metrics.forEach((item, idx) => {
      const r = 12 + idx;
      const cx = item.chilexpress?.price ?? 0;
      const leader = item.leader?.price ?? 0;
      summary.getCell(r,1).value = item.zone;
      summary.getCell(r,2).value = { formula: `IFERROR(SUMIFS('Benchmark Regional'!$D:$D,'Benchmark Regional'!$A:$A,$B$4,'Benchmark Regional'!$B:$B,A${r},'Benchmark Regional'!$C:$C,"Chilexpress"),"")`, result: cx || "" };
      summary.getCell(r,3).value = { formula: `IFERROR(MINIFS('Benchmark Regional'!$D:$D,'Benchmark Regional'!$A:$A,$B$4,'Benchmark Regional'!$B:$B,A${r}),"")`, result: leader || "" };
      summary.getCell(r,4).value = item.leader?.label ?? "—";
      summary.getCell(r,5).value = { formula: `IFERROR(B${r}/C${r}-1,"")`, result: item.premium ?? "" };
      summary.getCell(r,6).value = (item.confidence || 0)/100;
      summary.getCell(r,7).value = { formula: `IF(E${r}="","",ROUND(MIN(100,MAX(0,E${r}*100/3.5))*0.8+F${r}*100*0.2,0))`, result: item.score };
      summary.getCell(r,8).value = { formula: `IF(E${r}="","Completar evidencia",IF(E${r}>=1,"Crear tier / test",IF(E${r}>=0.45,"Ajustar selectivamente",IF(E${r}>=0.15,"Validar elasticidad","Defender posición"))))`, result: item.action };
      summary.getCell(r,9).value = item.chilexpress?.destinations ?? 0;
      summary.getCell(r,10).value = item.chilexpress?.channel ?? "—";
      summary.getCell(r,2).numFmt = moneyFmt;
      summary.getCell(r,3).numFmt = moneyFmt;
      summary.getCell(r,5).numFmt = pctFmt;
      summary.getCell(r,6).numFmt = pctFmt;
      for (let c=1;c<=10;c++) {
        thinGrid(summary.getCell(r,c));
        summary.getCell(r,c).alignment = { vertical: "middle", horizontal: c===1||c===4||c===8||c===10 ? "left":"center", wrapText: true };
      }
    });

    summary.mergeCells("A17:J17");
    summary.getCell("A17").value = "RECOMENDACIÓN PARA DIRECTORIO";
    styleSection(summary.getCell("A17"));
    summary.mergeCells("A18:J20");
    summary.getCell("A18").value = topOpportunity
      ? `Priorizar ${topOpportunity.zone}. Ejecutar un test de precio segmentado y controlado, proteger margen mínimo y medir conversión, contribución y retención antes de escalar. El escenario financiero detallado se encuentra en la pestaña “Escenario”.`
      : "Completar cobertura comparable y luego priorizar test por macrozona.";
    summary.getCell("A18").font = { size: 11, bold: true, color: { argb: C.navy } };
    summary.getCell("A18").fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.softYellow } };
    summary.getCell("A18").alignment = { vertical: "middle", horizontal: "left", wrapText: true };

    // 2. Benchmark Regional / histórico
    const benchmark = workbook.addWorksheet("Benchmark Regional", {
      views: [{ state: "frozen", ySplit: 6 }],
      properties: { defaultRowHeight: 18 },
    });
    styleTitle(benchmark, "BENCHMARK REGIONAL · HISTÓRICO", "Base analítica del reporte. Fórmulas de índice, premium y ranking quedan activas para análisis adicional.", 12);
    benchmark.columns = [
      { width: 12 },{ width: 13 },{ width: 19 },{ width: 15 },{ width: 13 },{ width: 11 },
      { width: 13 },{ width: 18 },{ width: 28 },{ width: 14 },{ width: 14 },{ width: 10 },
    ];
    benchmark.getRow(5).values = ["Mes","Macrozona","Empresa","Precio CLP","Confianza","Destinos","Observaciones","Canal","Plan","Price Index","Premium vs líder","Rank"];
    headerRow(benchmark.getRow(5));
    const historySource = history.length ? history : zones.flatMap((zone) => zone.rows.map((row) => ({
      month: selectedMonth,
      zone: zone.zone,
      company: row.label,
      priceClp: row.price,
      confidence: row.confidence,
      destinations: row.destinations,
      observations: row.observations,
      channel: row.channel,
      plan: row.plan,
    })));
    historySource.forEach((row, idx) => {
      const r = 6 + idx;
      const same = historySource.filter(x=>x.month===row.month && x.zone===row.zone);
      const leader = Math.min(...same.map(x=>x.priceClp));
      const index = leader ? row.priceClp/leader : 0;
      const rank = 1 + same.filter(x=>x.priceClp<row.priceClp).length;
      benchmark.getRow(r).values = [row.month,row.zone,row.company,row.priceClp,row.confidence/100,row.destinations,row.observations,row.channel,row.plan];
      benchmark.getCell(r,10).value = { formula: `IFERROR(D${r}/MINIFS($D:$D,$A:$A,A${r},$B:$B,B${r}),"")`, result: index };
      benchmark.getCell(r,11).value = { formula: `IFERROR(J${r}-1,"")`, result: index ? index-1 : "" };
      benchmark.getCell(r,12).value = { formula: `IFERROR(1+COUNTIFS($A:$A,A${r},$B:$B,B${r},$D:$D,"<"&D${r}),"")`, result: rank };
      benchmark.getCell(r,4).numFmt = moneyFmt;
      benchmark.getCell(r,5).numFmt = pctFmt;
      benchmark.getCell(r,10).numFmt = "0";
      benchmark.getCell(r,11).numFmt = pctFmt;
      for(let c=1;c<=12;c++) {
        thinGrid(benchmark.getCell(r,c));
        benchmark.getCell(r,c).alignment={vertical:"middle",horizontal:c===3||c===8||c===9?"left":"center",wrapText:true};
      }
    });
    benchmark.autoFilter = { from: "A5", to: `L${Math.max(6,5+historySource.length)}` };

    // 3. Oportunidades
    const opp = workbook.addWorksheet("Oportunidades", { views: [{ state: "frozen", ySplit: 5 }] });
    styleTitle(opp, "MAPA DE OPORTUNIDADES", `Priorización por macrozona · ${monthLong(selectedMonth)}`, 9);
    opp.columns = [{width:14},{width:17},{width:17},{width:18},{width:15},{width:16},{width:18},{width:28},{width:18}];
    opp.getRow(5).values = ["Macrozona","Chilexpress","Líder","Empresa líder","Premium","Confianza CX","Score","Acción","Observaciones CX"];
    headerRow(opp.getRow(5));
    metrics.forEach((item,idx)=>{
      const r=6+idx;
      opp.getCell(r,1).value=item.zone;
      opp.getCell(r,2).value={formula:`IFERROR(SUMIFS('Benchmark Regional'!$D:$D,'Benchmark Regional'!$A:$A,"${selectedMonth}",'Benchmark Regional'!$B:$B,A${r},'Benchmark Regional'!$C:$C,"Chilexpress"),"")`,result:item.chilexpress?.price??""};
      opp.getCell(r,3).value={formula:`IFERROR(MINIFS('Benchmark Regional'!$D:$D,'Benchmark Regional'!$A:$A,"${selectedMonth}",'Benchmark Regional'!$B:$B,A${r}),"")`,result:item.leader?.price??""};
      opp.getCell(r,4).value=item.leader?.label??"—";
      opp.getCell(r,5).value={formula:`IFERROR(B${r}/C${r}-1,"")`,result:item.premium??""};
      opp.getCell(r,6).value=(item.confidence||0)/100;
      opp.getCell(r,7).value={formula:`IF(E${r}="","",ROUND(MIN(100,MAX(0,E${r}*100/3.5))*0.8+F${r}*100*0.2,0))`,result:item.score};
      opp.getCell(r,8).value={formula:`IF(E${r}="","Completar evidencia",IF(E${r}>=1,"Crear tier / test",IF(E${r}>=0.45,"Ajustar selectivamente",IF(E${r}>=0.15,"Validar elasticidad","Defender posición"))))`,result:item.action};
      opp.getCell(r,9).value=item.chilexpress?.observations??0;
      opp.getCell(r,2).numFmt=moneyFmt; opp.getCell(r,3).numFmt=moneyFmt; opp.getCell(r,5).numFmt=pctFmt; opp.getCell(r,6).numFmt=pctFmt;
      for(let c=1;c<=9;c++){thinGrid(opp.getCell(r,c));opp.getCell(r,c).alignment={vertical:"middle",horizontal:c===4||c===8?"left":"center",wrapText:true};}
    });

    // 4. Escenario formulado
    const scenarioWs = workbook.addWorksheet("Escenario", { views: [{ state: "frozen", ySplit: 3 }] });
    styleTitle(scenarioWs, "SIMULADOR EJECUTIVO", "Celdas amarillas = supuestos editables. Celdas azules = fórmulas. El reporte se recalcula al abrir Excel.", 8);
    scenarioWs.columns=[{width:28},{width:18},{width:4},{width:30},{width:22},{width:18},{width:18},{width:18}];

    scenarioWs.mergeCells("A4:B4"); scenarioWs.getCell("A4").value="SUPUESTOS EDITABLES"; styleSection(scenarioWs.getCell("A4"));
    scenarioWs.getCell("A5").value="Mes analizado"; scenarioWs.getCell("B5").value=selectedMonth;
    scenarioWs.getCell("A6").value="Macrozona"; scenarioWs.getCell("B6").value=selected?.zone??"Norte";
    scenarioWs.getCell("A7").value="Volumen mensual actual"; scenarioWs.getCell("B7").value=monthlyVolume; scenarioWs.getCell("B7").numFmt=integerFmt;
    scenarioWs.getCell("A8").value="Cambio de precio"; scenarioWs.getCell("B8").value=priceChange; scenarioWs.getCell("B8").numFmt=pctFmt;
    scenarioWs.getCell("A9").value="Cambio esperado de volumen"; scenarioWs.getCell("B9").value=volumeChange; scenarioWs.getCell("B9").numFmt=pctFmt;
    scenarioWs.getCell("A10").value="Costo unitario supuesto"; scenarioWs.getCell("B10").value=costShare; scenarioWs.getCell("B10").numFmt=pctFmt;
    scenarioWs.getCell("A11").value="Margen mínimo objetivo"; scenarioWs.getCell("B11").value=targetMargin; scenarioWs.getCell("B11").numFmt=pctFmt;
    ["B5","B6","B7","B8","B9","B10","B11"].forEach((addr)=>{scenarioWs.getCell(addr).fill={type:"pattern",pattern:"solid",fgColor:{argb:C.input}};scenarioWs.getCell(addr).font={bold:true,color:{argb:C.navy}};});
    scenarioWs.getCell("B6").dataValidation={type:"list",allowBlank:false,formulae:['"Norte,Centro,Sur"']};

    scenarioWs.mergeCells("D4:E4"); scenarioWs.getCell("D4").value="RESULTADOS FORMULADOS"; styleSection(scenarioWs.getCell("D4"));
    const formulaRows=[
      ["Precio actual Chilexpress",`IFERROR(SUMIFS('Benchmark Regional'!$D:$D,'Benchmark Regional'!$A:$A,$B$5,'Benchmark Regional'!$B:$B,$B$6,'Benchmark Regional'!$C:$C,"Chilexpress"),0)`,currentPrice,moneyFmt],
      ["Líder de precio",`IFERROR(MINIFS('Benchmark Regional'!$D:$D,'Benchmark Regional'!$A:$A,$B$5,'Benchmark Regional'!$B:$B,$B$6),0)`,leaderPrice,moneyFmt],
      ["Costo unitario estimado","E5*$B$10",unitCost,moneyFmt],
      ["Nuevo precio","E5*(1+$B$8)",newPrice,moneyFmt],
      ["Nuevo volumen","$B$7*(1+$B$9)",newVolume,integerFmt],
      ["Ingresos actuales","E5*$B$7",currentRevenue,moneyFmt],
      ["Ingresos modelados","E8*E9",newRevenue,moneyFmt],
      ["Contribución actual","(E5-E7)*$B$7",currentContribution,moneyFmt],
      ["Contribución modelada","(E8-E7)*E9",newContribution,moneyFmt],
      ["Margen actual","IFERROR((E5-E7)/E5,0)",currentMargin,pctFmt],
      ["Margen modelado","IFERROR((E8-E7)/E8,0)",newMargin,pctFmt],
      ["Piso por margen","IFERROR(E7/(1-$B$11),0)",floorPrice,moneyFmt],
      ["Rango recomendado · bajo","MAX(E16,E6*1.1)",recLow,moneyFmt],
      ["Rango recomendado · alto","MAX(E17,MIN(E5*0.92,E6*1.6))",recHigh,moneyFmt],
      ["Punto medio sugerido","AVERAGE(E17:E18)",recMid,moneyFmt],
      ["Ajuste punto medio vs actual","IFERROR(E19/E5-1,0)",recDelta,pctFmt],
    ] as const;
    formulaRows.forEach((item,idx)=>{
      const r=5+idx;
      scenarioWs.getCell(r,4).value=item[0];
      scenarioWs.getCell(r,5).value={formula:item[1],result:item[2]};
      scenarioWs.getCell(r,5).numFmt=item[3];
      scenarioWs.getCell(r,5).fill={type:"pattern",pattern:"solid",fgColor:{argb:C.formula}};
      scenarioWs.getCell(r,5).font={bold:true,color:{argb:C.navy}};
      thinGrid(scenarioWs.getCell(r,4)); thinGrid(scenarioWs.getCell(r,5));
    });

    scenarioWs.mergeCells("A14:B14"); scenarioWs.getCell("A14").value="REGLAS DE LECTURA"; styleSection(scenarioWs.getCell("A14"));
    scenarioWs.mergeCells("A15:B20");
    scenarioWs.getCell("A15").value="• El costo unitario se mantiene constante en el escenario demo.\n• El cambio de volumen es un supuesto editable, no elasticidad estimada.\n• El rango recomendado protege el margen objetivo y aproxima la oferta al mercado.\n• La decisión final debe combinar precio, SLA, cobertura, seguro y conversión.";
    scenarioWs.getCell("A15").alignment={vertical:"top",horizontal:"left",wrapText:true};
    scenarioWs.getCell("A15").font={size:10,color:{argb:C.navy}};
    scenarioWs.getCell("A15").fill={type:"pattern",pattern:"solid",fgColor:{argb:C.soft}};

    // 5. Metodología
    const methodology = workbook.addWorksheet("Metodología");
    styleTitle(methodology, "METODOLOGÍA Y TRAZABILIDAD", "Criterios utilizados para que el reporte sea defendible frente a Directorio, Pricing y Finanzas.", 6);
    methodology.columns=[{width:27},{width:72},{width:26},{width:34},{width:34},{width:34}];
    methodology.getRow(5).values=["Tema","Criterio","Umbral / regla","Fuente","Uso en reporte","Advertencia"];
    headerRow(methodology.getRow(5));
    const methods=[
      ["Perfil comparable","Origen Santiago, paquete ≤0,5 kg y entrega a domicilio.","≤0,5 kg","https://www.chilexpress.cl","Benchmark y matrices","No mezclar punto/sucursal con domicilio."],
      ["Capa B2B","Prioridad a tarifa Pyme/Emprendedores publicada; fallback a evidencia Empresa / Mercado Público.","Pyme primero","https://www.mercadopublico.cl","Benchmark Regional","No confundir tarifa pública B2C con B2B."],
      ["Confianza","Se excluyen fuentes con confianza insuficiente y se ponderan las observaciones aceptadas.","Fuente ≥90%; celda ≥82%","MGP Super Precios","Resumen Directorio","Una celda vacía es preferible a falsa precisión."],
      ["Promedio robusto","Cuando hay muestra suficiente se recortan extremos y se pondera por confianza.","Trim 10% si n≥10","MGP Super Precios","Precio promedio por zona","No implica precio contractual de todos los clientes."],
      ["Escenario financiero","Costo, volumen y margen son supuestos editables para testear sensibilidad.","Editable","Inputs del usuario","Escenario","No reemplaza costos reales ni elasticidad econométrica."],
      ["Correos Chile","Estructuras INTRA/CERCA/LEJOS sólo se incluyen donde existe equivalencia territorial defendible.","Sin imputación artificial","https://www.correos.cl","Benchmark","Evitar mapear zonas sin evidencia oficial."],
      ["Blue Express","Tarifas Pyme/Ecommerce se tratan como B2B cuando el plan observado corresponde al segmento.","Plan observado","https://www.blue.cl","Benchmark","Validar vigencia en cada corrida."],
      ["Starken","Se prioriza Tarifa Simple para benchmark Pyme; otros tiers quedan disponibles como referencia.","Plan preferido","https://www.starken.cl","Benchmark","No mezclar tiers en una misma celda."],
    ];
    methods.forEach((row,idx)=>{
      methodology.getRow(6+idx).values=row;
      for(let c=1;c<=6;c++){thinGrid(methodology.getCell(6+idx,c));methodology.getCell(6+idx,c).alignment={vertical:"top",horizontal:"left",wrapText:true};}
      methodology.getRow(6+idx).height=42;
    });
    methodology.mergeCells("A16:F16"); methodology.getCell("A16").value="NOTA PARA DIRECTORIO"; styleSection(methodology.getCell("A16"));
    methodology.mergeCells("A17:F19");
    methodology.getCell("A17").value="Este archivo está diseñado como soporte ejecutivo: el Resumen Directorio sintetiza las decisiones; Benchmark Regional conserva la trazabilidad; Oportunidades prioriza acción; y Escenario mantiene fórmulas para discutir sensibilidad en vivo. Las cifras de costos y elasticidad son supuestos hasta conectar data real de Chilexpress.";
    methodology.getCell("A17").alignment={vertical:"middle",horizontal:"left",wrapText:true};
    methodology.getCell("A17").font={size:11,bold:true,color:{argb:C.navy}};
    methodology.getCell("A17").fill={type:"pattern",pattern:"solid",fgColor:{argb:C.softYellow}};

    // General polish
    for (const ws of workbook.worksheets) {
      ws.eachRow((row:any) => {
        row.eachCell((cell:any) => {
          if (!cell.font?.name) cell.font = { ...(cell.font || {}), name: "Aptos", size: cell.font?.size || 9 };
        });
      });
      ws.properties.defaultRowHeight = 18;
    }

    const output = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(output as ArrayBuffer);

    return new Response(buffer, {
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="chilexpress-pricing-directorio-${selectedMonth.replace("-","")}.xlsx"`,
        "cache-control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("executive_excel_error", error);
    return Response.json({ error: error instanceof Error ? error.message : "No fue posible generar el reporte Excel." }, { status: 500 });
  }
}
