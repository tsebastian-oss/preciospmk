import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RegionalPayload = {
  origin?: string;
  weightKg?: number;
  delivery?: string;
  service?: string;
  providers?: string[];
  coverage?: Record<string, unknown>;
  slaMap?: Record<string, string>;
  zones?: Array<Record<string, unknown>>;
  regions?: Array<Record<string, unknown>>;
  notes?: string[];
};

const SERVICES = ["Básico", "Estándar", "Prioritario"] as const;

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const rawWeight = Number(request.nextUrl.searchParams.get("weight") ?? "0.5");
  const weight = [0.5, 3, 6].includes(rawWeight) ? rawWeight : 0.5;
  const rawDays = Number(request.nextUrl.searchParams.get("days") ?? "30");
  const days = Math.max(1, Math.min(Number.isFinite(rawDays) ? rawDays : 30, 365));

  const results = await Promise.all(
    SERVICES.map((service) =>
      enterpriseRpc<RegionalPayload>(
        request,
        "chilexpress_b2c_region_dashboard_v2",
        { p_days: days, p_weight: weight, p_service: service },
      ),
    ),
  );

  for (const result of results) {
    if (result.response) return result.response;
  }

  const services = Object.fromEntries(
    SERVICES.map((service, index) => [service, results[index].data ?? null]),
  );

  return NextResponse.json({
    weightKg: weight,
    days,
    services,
    methodology: {
      comparison: "Cada competidor se compara contra Básico, Estándar y Prioritario de Chilexpress por la misma ruta/peso cuando existe precio capturado.",
      slaWarning: "Las brechas de precio no implican equivalencia de SLA. Se conserva la etiqueta de servicio/equivalencia publicada por cada courier.",
      missingPolicy: "Si no existe una tarifa Chilexpress capturada para un nivel, se muestra vacío; no se estima.",
    },
  }, {
    headers: { "cache-control": "private, no-store" },
  });
}
