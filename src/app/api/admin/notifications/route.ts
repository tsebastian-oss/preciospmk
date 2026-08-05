import { NextRequest } from "next/server";
import { enterpriseJson, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return enterpriseJson(await enterpriseRpc(request, "admin_notification_status"));
}

export async function POST(request: NextRequest) {
  const payload = await request.json() as {
    apiKey?: string;
    provider?: "resend" | "brevo";
    fromEmail?: string;
    fromName?: string;
    enabled?: boolean;
  };
  return enterpriseJson(await enterpriseRpc(request, "admin_set_notification_config", {
    p_api_key: payload.apiKey?.trim() || null,
    p_provider: payload.provider ?? "resend",
    p_from_email: payload.fromEmail?.trim() || null,
    p_from_name: payload.fromName?.trim() || "MGP Intelligence",
    p_enabled: Boolean(payload.enabled),
  }));
}
