import { NextRequest } from "next/server";
import { enterpriseJson, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  return enterpriseJson(await enterpriseRpc(request, "enterprise_data_quality", {
    p_organization_id: organizationId || null,
  }));
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({})) as { organizationId?: string | null };
  return enterpriseJson(await enterpriseRpc(request, "enterprise_capture_data_quality", {
    p_organization_id: payload.organizationId ?? null,
  }));
}
