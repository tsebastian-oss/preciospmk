import { NextRequest, NextResponse } from "next/server";
import { enterpriseJson, enterpriseRest, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

type AlertPayload = {
  organizationId: string;
  id?: string | null;
  name: string;
  alertType: string;
  severity: string;
  scope?: Record<string, unknown>;
  condition?: Record<string, unknown>;
  channels?: string[];
  recipients?: string[];
  enabled?: boolean;
};

export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "Falta organizationId" }, { status: 400 });
  return enterpriseJson(await enterpriseRest(request, "alert_rules", {
    query: {
      select: "*",
      organization_id: `eq.${organizationId}`,
      order: "created_at.desc",
    },
  }), []);
}

export async function POST(request: NextRequest) {
  const payload = await request.json() as AlertPayload;
  if (!payload.organizationId || payload.name.trim().length < 2) {
    return NextResponse.json({ error: "Organización y nombre son obligatorios" }, { status: 400 });
  }
  return enterpriseJson(await enterpriseRpc(request, "enterprise_upsert_alert", {
    p_organization_id: payload.organizationId,
    p_id: payload.id ?? null,
    p_name: payload.name.trim(),
    p_alert_type: payload.alertType,
    p_severity: payload.severity,
    p_scope: payload.scope ?? {},
    p_condition: payload.condition ?? {},
    p_channels: payload.channels ?? ["email"],
    p_recipients: payload.recipients ?? [],
    p_enabled: payload.enabled ?? true,
  }));
}

export async function DELETE(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  const id = request.nextUrl.searchParams.get("id");
  if (!organizationId || !id) return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
  return enterpriseJson(await enterpriseRpc(request, "enterprise_delete_alert", {
    p_organization_id: organizationId,
    p_id: id,
  }));
}
