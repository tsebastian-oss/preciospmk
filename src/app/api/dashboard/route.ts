import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, "overview");
  if (authorization.response) return authorization.response;

  const result = await enterpriseRpc<Record<string, unknown>>(request, "enterprise_dashboard_bootstrap", {
    p_organization_id: authorization.access?.organizationId,
  });
  if (result.response) return result.response;

  const coverage = await enterpriseRpc<Record<string, unknown>>(request, "enterprise_pharmacy_crawl_coverage", {
    p_organization_id: authorization.access?.organizationId,
  });

  const payload = result.data ?? {
    summary: null,
    supermarkets: [],
    categories: [],
    run: null,
    topOffers: [],
  };

  return NextResponse.json({
    ...payload,
    pharmacyCoverage: coverage.response ? { parallel: true, retailers: [] } : (coverage.data ?? { parallel: true, retailers: [] }),
  });
}
