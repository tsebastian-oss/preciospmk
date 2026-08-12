import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess } from "@/lib/enterprise-auth";
import {
  generateAutomotiveBrandSummary,
  openAiAutomotiveSummaryConfigured,
  type AutomotiveBrandSummaryInput,
} from "@/lib/openai-automotive-summary";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function finite(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: unknown, max = 140) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function cleanRows(value: unknown): AutomotiveBrandSummaryInput["rows"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).map((row: any) => ({
    brand: cleanText(row?.brand, 100),
    dealer: cleanText(row?.dealer, 120),
    currentAverage: finite(row?.currentAverage),
    previousAverage: finite(row?.previousAverage),
    absoluteChange: finite(row?.absoluteChange),
    percentageChange: row?.percentageChange === null || row?.percentageChange === undefined
      ? null
      : finite(row.percentageChange),
    versions: Math.max(0, Math.round(finite(row?.versions))),
    comparableVersions: Math.max(0, Math.round(finite(row?.comparableVersions))),
    increasedVersions: Math.max(0, Math.round(finite(row?.increasedVersions))),
    decreasedVersions: Math.max(0, Math.round(finite(row?.decreasedVersions))),
    unchangedVersions: Math.max(0, Math.round(finite(row?.unchangedVersions))),
  })).filter((row) => row.brand && row.dealer && row.currentAverage > 0);
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;
  if (!authorization.access) return NextResponse.json({ error: "No fue posible resolver el acceso enterprise." }, { status: 500 });
  if (!openAiAutomotiveSummaryConfigured()) {
    return NextResponse.json({ error: "OpenAI no está configurado para el resumen automotriz." }, { status: 503 });
  }

  try {
    const body = await request.json();
    const comparison: AutomotiveBrandSummaryInput["comparison"] = body?.comparison === "previous_month"
      ? "previous_month"
      : "previous_week";
    const rows = cleanRows(body?.rows);
    if (!rows.length) return NextResponse.json({ error: "No hay datos comparables para resumir." }, { status: 400 });

    const result = await generateAutomotiveBrandSummary({ comparison, rows });
    return NextResponse.json(result, {
      headers: { "cache-control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.warn("Automotive brand summary failed", {
      name: error instanceof Error ? error.name : "unknown",
      status: Number((error as { status?: number })?.status || 0) || undefined,
    });
    return NextResponse.json({ error: "No fue posible generar el resumen ejecutivo con OpenAI." }, { status: 503 });
  }
}
