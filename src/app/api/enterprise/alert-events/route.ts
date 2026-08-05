import { NextRequest, NextResponse } from "next/server";
import { enterpriseJson, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 50)));
  if (!organizationId) return NextResponse.json({ error: "Falta organizationId" }, { status: 400 });
  return enterpriseJson(await enterpriseRpc(request, "enterprise_alert_feed", {
    p_organization_id: organizationId,
    p_limit: limit,
  }));
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({})) as {
    organizationId?: string;
    eventId?: number;
    status?: "acknowledged" | "resolved" | "suppressed";
  };
  if (!payload.organizationId || !payload.eventId || !payload.status) {
    return NextResponse.json({ error: "Faltan datos del evento" }, { status: 400 });
  }
  return enterpriseJson(await enterpriseRpc(request, "enterprise_update_alert_event", {
    p_organization_id: payload.organizationId,
    p_event_id: payload.eventId,
    p_status: payload.status,
  }));
}
