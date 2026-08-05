import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRest, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

type Industry = {
  slug: string;
  name: string;
  description: string;
  retailer_types: string[];
  display_order: number;
};

type Selection = { industrySlug: string; industryName: string };

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, null);
  if (authorization.response) return authorization.response;
  const access = authorization.access!;

  const industries = await enterpriseRest<Industry[]>(request, "industries", {
    query: {
      select: "slug,name,description,retailer_types,display_order",
      active: "eq.true",
      order: "display_order.asc,name.asc",
    },
  });
  if (industries.response) return industries.response;

  return NextResponse.json({
    industries: industries.data ?? [],
    organizationId: access.organizationId,
    organizationName: access.organizationName,
    industrySlug: access.industrySlug ?? null,
    industryName: access.industryName ?? null,
    industryConfigured: Boolean(access.industryConfigured),
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, null);
  if (authorization.response) return authorization.response;
  const access = authorization.access!;
  const body = await request.json().catch(() => ({})) as { industrySlug?: unknown };
  const industrySlug = typeof body.industrySlug === "string" ? body.industrySlug.trim() : "";
  if (!industrySlug || industrySlug.length > 80) {
    return NextResponse.json({ error: "Selecciona una industria válida." }, { status: 400 });
  }

  const result = await enterpriseRpc<Selection>(request, "enterprise_set_industry", {
    p_organization_id: access.organizationId,
    p_industry_slug: industrySlug,
  });
  if (result.response) return result.response;
  return NextResponse.json({ ...result.data, industryConfigured: true }, { headers: { "cache-control": "private, no-store" } });
}
