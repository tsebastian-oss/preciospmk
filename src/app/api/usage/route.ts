import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseJson, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

type UsagePayload = {
  sessionId?: string;
  eventName?: string;
  module?: string | null;
  path?: string | null;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  let payload: UsagePayload;
  try {
    payload = await request.json() as UsagePayload;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  if (!payload.sessionId || !payload.eventName) {
    return NextResponse.json({ error: "Evento incompleto" }, { status: 400 });
  }

  const accessResult = await enterpriseAccess(request, null);
  if (accessResult.response) return accessResult.response;
  const access = accessResult.access!;

  const rawMetadata = payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const metadata = {
    ...rawMetadata,
    userAgent: String(rawMetadata.userAgent || request.headers.get("user-agent") || "").slice(0, 500),
  };

  return enterpriseJson(await enterpriseRpc(request, "enterprise_record_usage_event", {
    p_organization_id: access.organizationId,
    p_session_id: payload.sessionId,
    p_event_name: String(payload.eventName).slice(0, 48),
    p_module: payload.module ? String(payload.module).slice(0, 100) : null,
    p_path: payload.path ? String(payload.path).slice(0, 500) : null,
    p_duration_ms: Math.max(0, Math.min(60000, Math.round(Number(payload.durationMs || 0)))),
    p_metadata: metadata,
  }), { ok: true });
}
