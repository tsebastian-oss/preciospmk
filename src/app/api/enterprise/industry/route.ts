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

type Selection = { industrySlug: string; industryName: string; retailers?: string[]; trialScopeConfigured?: boolean };
type RetailerOption = { name: string; products: number };
type RetailerChannel = { code: string; name: string; retailers: RetailerOption[] };
type RetailerOptionsPayload = { channels?: RetailerChannel[] };

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

  let channels: RetailerChannel[] = [];
  if (access.status === "trial") {
    const options = await enterpriseRpc<RetailerOptionsPayload>(request, "enterprise_trial_retailer_options", {
      p_organization_id: access.organizationId,
    });
    if (options.response) return options.response;
    channels = options.data?.channels ?? [];
  }

  const trialScopeConfigured = access.status !== "trial"
    || Boolean((access.limits as unknown as Record<string, unknown> | null)?.trial_scope_configured);
  const onboardingConfigured = Boolean(access.industryConfigured) && trialScopeConfigured;

  return NextResponse.json({
    industries: industries.data ?? [],
    organizationId: access.organizationId,
    organizationName: access.organizationName,
    organizationStatus: access.status,
    industrySlug: access.industrySlug ?? null,
    industryName: access.industryName ?? null,
    industryConfigured: onboardingConfigured,
    trialScopeConfigured,
    retailers: access.retailers ?? [],
    channels,
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const authorization = await enterpriseAccess(request, null);
  if (authorization.response) return authorization.response;
  const access = authorization.access!;
  const body = await request.json().catch(() => ({})) as { industrySlug?: unknown; retailers?: unknown };
  const industrySlug = typeof body.industrySlug === "string" ? body.industrySlug.trim() : "";
  if (!industrySlug || industrySlug.length > 80) {
    return NextResponse.json({ error: "Selecciona una industria válida." }, { status: 400 });
  }

  if (access.status === "trial") {
    const retailers = Array.isArray(body.retailers)
      ? body.retailers.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
      : [];
    if (retailers.length < 1 || retailers.length > 3) {
      return NextResponse.json({ error: "Selecciona entre 1 y 3 retailers para tu trial." }, { status: 400 });
    }
    const result = await enterpriseRpc<Selection>(request, "enterprise_configure_trial_onboarding", {
      p_organization_id: access.organizationId,
      p_industry_slug: industrySlug,
      p_retailers: retailers,
    });
    if (result.response) return result.response;
    return NextResponse.json({ ...result.data, industryConfigured: true }, { headers: { "cache-control": "private, no-store" } });
  }

  const result = await enterpriseRpc<Selection>(request, "enterprise_set_industry", {
    p_organization_id: access.organizationId,
    p_industry_slug: industrySlug,
  });
  if (result.response) return result.response;
  return NextResponse.json({ ...result.data, industryConfigured: true }, { headers: { "cache-control": "private, no-store" } });
}
