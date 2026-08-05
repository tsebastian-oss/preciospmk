import { NextRequest, NextResponse } from "next/server";
import { enterpriseJson, enterpriseRest, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";

export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "Falta organizationId" }, { status: 400 });
  return enterpriseJson(await enterpriseRest(request, "report_jobs", {
    query: {
      select: "*",
      organization_id: `eq.${organizationId}`,
      order: "requested_at.desc",
      limit: "50",
    },
  }), []);
}

export async function POST(request: NextRequest) {
  const payload = await request.json() as {
    organizationId?: string;
    reportType?: string;
    format?: "pdf" | "xlsx" | "csv";
    parameters?: Record<string, unknown>;
  };
  if (!payload.organizationId || !payload.reportType) {
    return NextResponse.json({ error: "Organización y tipo de reporte son obligatorios" }, { status: 400 });
  }
  if (!payload.format || !["pdf", "xlsx", "csv"].includes(payload.format)) {
    return NextResponse.json({ error: "Formato de reporte no soportado" }, { status: 400 });
  }

  const queued = await enterpriseRpc<Record<string, unknown> & { id?: string }>(request, "enterprise_request_report", {
    p_organization_id: payload.organizationId,
    p_report_type: payload.reportType,
    p_format: payload.format,
    p_parameters: payload.parameters ?? {},
  });
  if (queued.response) return queued.response;
  if (!queued.data?.id) return NextResponse.json({ error: "No fue posible crear el reporte" }, { status: 500 });

  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const workerResponse = await fetch(`${SUPABASE_URL}/functions/v1/enterprise-report-worker`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jobId: queued.data.id }),
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  }).catch((error) => ({ ok: false, status: 503, json: async () => ({ error: error instanceof Error ? error.message : "Worker no disponible" }) } as Response));

  const generated = await workerResponse.json().catch(() => ({ error: "Respuesta inválida del generador" })) as {
    job?: Record<string, unknown>;
    error?: string;
    detail?: string;
  };
  if (!workerResponse.ok) {
    return NextResponse.json({
      job: queued.data,
      warning: generated.detail || generated.error || "El reporte quedó en cola, pero no pudo generarse inmediatamente.",
    }, { status: 202 });
  }
  return NextResponse.json(generated.job ?? queued.data);
}
