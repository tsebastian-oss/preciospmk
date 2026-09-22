import { NextRequest, NextResponse } from "next/server";
import { brandScopeAllows, enterpriseAccess } from "@/lib/enterprise-auth";
import {
  getVictorinoxFxSeries,
  simulateVictorinoxFxMargin,
  summarizeVictorinoxFx,
  VictorinoxFxUnavailableError,
} from "@/lib/victorinox-fx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function optionalNumber(params: URLSearchParams, key: string, min: number, max: number) {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "brand-panel");
  if (authorization.response) return authorization.response;
  if (!authorization.access || !brandScopeAllows(authorization.access, "victorinox")) {
    return NextResponse.json({ error: "Victorinox no está habilitado para esta cuenta." }, { status: 403 });
  }

  const requestedDays = Number(request.nextUrl.searchParams.get("days") ?? 400);
  const days = Number.isFinite(requestedDays) ? requestedDays : 400;
  try {
    const series = await getVictorinoxFxSeries(days);
    const summary = summarizeVictorinoxFx(series.points);
    const margin = optionalNumber(request.nextUrl.searchParams, "grossMarginPct", 0, 99.9);
    const chfShare = optionalNumber(request.nextUrl.searchParams, "chfCostSharePct", 0, 100);
    const priceAdjustment = optionalNumber(request.nextUrl.searchParams, "priceAdjustmentPct", -99, 100);
    const year = summary.periods.find((period) => period.days === 365) ?? summary.periods.at(-1);
    const scenario = margin !== null && chfShare !== null && priceAdjustment !== null && year
      ? simulateVictorinoxFxMargin(summary.current, year.baseline, {
        baselineGrossMarginPct: margin,
        chfLinkedCostSharePct: chfShare,
        localPriceAdjustmentPct: priceAdjustment,
      })
      : null;

    return NextResponse.json({
      asOf: summary.current.date,
      fetchedAt: series.fetchedAt,
      source: series.source,
      cacheStatus: series.cacheStatus,
      methodology: {
        cadence: "Última referencia diaria publicada; no es una cotización intradía.",
        chfClp: "Pesos chilenos por franco suizo.",
        usdClp: "Pesos chilenos por dólar estadounidense.",
        relativeChfPressurePct: "Apreciación acumulada del CHF/CLP descontando el movimiento del USD/CLP; proxy cambiario de presión frente a competidores dolarizados.",
      },
      summary,
      points: series.points,
      scenario,
    }, {
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "x-data-mode": "real-reference-rates",
        "x-fx-cache": series.cacheStatus,
      },
    });
  } catch (error) {
    console.error("victorinox-fx-unavailable", error);
    const message = error instanceof VictorinoxFxUnavailableError
      ? error.message
      : "No fue posible cargar el contexto cambiario.";
    return NextResponse.json({ error: message, transient: true }, { status: 503 });
  }
}
