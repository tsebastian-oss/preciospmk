import { NextRequest, NextResponse } from "next/server";
import { enterpriseJson, enterpriseRest, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

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
    format?: string;
    parameters?: Record<string, unknown>;
  };
  if (!payload.organizationId || !payload.reportType) {
    return NextResponse.json({ error: "Organización y tipo de reporte son obligatorios" }, { status: 400 });
  }
  return enterpriseJson(await enterpriseRpc(request, "enterprise_request_report", {
    p_organization_id: payload.organizationId,
    p_report_type: payload.reportType,
    p_format: payload.format ?? "pdf",
    p_parameters: payload.parameters ?? {},
  }));
}
