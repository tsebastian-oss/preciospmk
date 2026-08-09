import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRest, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

type Feed = { events?: unknown[]; unread?: number };
type AlertRule = {
  id: string;
  name: string;
  alert_type: string;
  severity: string;
  scope: Record<string, unknown>;
  condition: Record<string, unknown>;
  channels: unknown;
  recipients: string[];
  enabled: boolean;
  cooldown_minutes: number;
  last_triggered_at: string | null;
  created_at: string;
};

const TYPES = new Set(["price_change", "promotion", "stock_out", "assortment_change", "new_product"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const EVENT_STATUSES = new Set(["acknowledged", "resolved", "suppressed"]);

function thresholdFor(type: string, raw: unknown) {
  const parsed = Number(raw ?? 0);
  if (type === "price_change") return Math.min(100, Math.max(1, Number.isFinite(parsed) ? parsed : 10));
  return Math.min(10_000, Math.max(1, Number.isFinite(parsed) ? Math.round(parsed) : 1));
}

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "alerts");
  if (authorization.response) return authorization.response;
  const access = authorization.access!;

  const [feed, rules] = await Promise.all([
    enterpriseRpc<Feed>(request, "enterprise_alert_feed", { p_organization_id: access.organizationId, p_limit: 80 }),
    enterpriseRest<AlertRule[]>(request, "alert_rules", {
      query: {
        select: "id,name,alert_type,severity,scope,condition,channels,recipients,enabled,cooldown_minutes,last_triggered_at,created_at",
        organization_id: `eq.${access.organizationId}`,
        order: "created_at.asc",
      },
    }),
  ]);
  if (feed.response) return feed.response;
  if (rules.response) return rules.response;

  return NextResponse.json({
    organizationId: access.organizationId,
    canManage: access.isSaasAdmin || ["owner", "admin", "analyst"].includes(access.role),
    events: feed.data?.events ?? [],
    unread: feed.data?.unread ?? 0,
    rules: rules.data ?? [],
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "alerts");
  if (authorization.response) return authorization.response;
  const access = authorization.access!;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "eventStatus") {
    const eventId = Number(body.eventId);
    const status = typeof body.status === "string" ? body.status : "";
    if (!Number.isSafeInteger(eventId) || eventId <= 0 || !EVENT_STATUSES.has(status)) {
      return NextResponse.json({ error: "Evento o estado inválido." }, { status: 400 });
    }
    const result = await enterpriseRpc(request, "enterprise_update_alert_event", {
      p_organization_id: access.organizationId,
      p_event_id: eventId,
      p_status: status,
    });
    if (result.response) return result.response;
    return NextResponse.json({ event: result.data });
  }

  if (action === "rule") {
    const alertType = typeof body.alertType === "string" ? body.alertType : "";
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
    const severity = typeof body.severity === "string" && SEVERITIES.has(body.severity) ? body.severity : "medium";
    const id = typeof body.id === "string" && body.id ? body.id : null;
    if (!TYPES.has(alertType) || name.length < 2) {
      return NextResponse.json({ error: "Tipo y nombre de alerta inválidos." }, { status: 400 });
    }
    const result = await enterpriseRpc(request, "enterprise_upsert_alert", {
      p_organization_id: access.organizationId,
      p_id: id,
      p_name: name,
      p_alert_type: alertType,
      p_severity: severity,
      p_scope: {},
      p_condition: { operator: "gte", threshold: thresholdFor(alertType, body.threshold) },
      p_channels: ["in_app"],
      p_recipients: [],
      p_enabled: body.enabled !== false,
    });
    if (result.response) return result.response;
    return NextResponse.json({ rule: result.data });
  }

  return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "alerts");
  if (authorization.response) return authorization.response;
  const access = authorization.access!;
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta la regla." }, { status: 400 });
  const result = await enterpriseRpc(request, "enterprise_delete_alert", {
    p_organization_id: access.organizationId,
    p_id: id,
  });
  if (result.response) return result.response;
  return NextResponse.json({ ok: true });
}
