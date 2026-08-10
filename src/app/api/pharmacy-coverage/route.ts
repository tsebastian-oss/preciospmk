import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const result = await enterpriseRpc<Record<string, unknown>>(request, "enterprise_pharmacy_crawl_coverage", {
    p_organization_id: authorization.access?.organizationId,
  });

  if (result.response) {
    if (result.response.status === 401 || result.response.status === 403) return result.response;
    return NextResponse.json({
      parallel: true,
      retailers: [],
      unavailable: true,
      error: "Cobertura temporalmente no disponible",
    });
  }

  return NextResponse.json(result.data ?? {
    parallel: true,
    retailers: [],
    unavailable: false,
  });
}
