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

function normalizedCondition(alertType: string, condition: Record<string, unknown> = {}) {
  const requestedThreshold = Number(condition.threshold ?? 0);
  if (alertType === "data_quality") {
    return {
      metric: typeof condition.metric === "string" ? condition.metric : "capture_completion_pct",
      operator: typeof condition.operator === "string" && ["lt", "lte"].includes(condition.operator) ? condition.operator : "lt",
      threshold: requestedThreshold > 50 && requestedThreshold <= 100 ? requestedThreshold : 98,
    };
  }
  if (["match_review", "new_product", "stock_out", "assortment_change", "promotion"].includes(alertType)) {
    return { operator: "gte", threshold: requestedThreshold >= 1 ? requestedThreshold : 1 };
  }
  if (alertType === "price_change") {
    return { operator: "gte", threshold: requestedThreshold > 0 ? requestedThreshold : 10 };
  }
  return condition;
}

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
    p_condition: normalizedCondition(payload.alertType, payload.condition),
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
