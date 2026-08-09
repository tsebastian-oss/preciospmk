import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, null);
  if (authorization.response) return authorization.response;
  const access = authorization.access!;

  const result = await enterpriseRpc<Record<string, unknown>>(request, "enterprise_retailer_data_health", {
    p_organization_id: access.organizationId,
  });
  if (result.response) return result.response;

  return NextResponse.json(result.data ?? {
    checkedAt: null,
    summary: { fresh: 0, warning: 0, stale: 0 },
    retailers: [],
  });
}
