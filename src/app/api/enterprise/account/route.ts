import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRpc } from "@/lib/enterprise-auth";

const DEFAULT_SUPABASE_URL = "https://yfpixszkiakwzrqdcfbw.supabase.co";
const DEFAULT_PUBLISHABLE_KEY = "sb_publishable_4FrGlw8owGm5EtwMs9V5zQ_oBrH0c0-";

export const dynamic = "force-dynamic";

type CommercialState = {
  status?: string;
  commercialPlan?: string;
  trialStartedAt?: string | null;
  trialExpiresAt?: string | null;
  intendedPlan?: string | null;
  billingCycle?: string | null;
  limits?: Record<string, number | boolean | null>;
  usage?: { exportsThisMonth?: number; activeUsers?: number; pendingInvitations?: number };
};

export async function GET(request: NextRequest) {
  const authorization = await enterpriseAccess(request, null);
  if (authorization.response) return authorization.response;
  const access = authorization.access!;
  const token = request.cookies.get("mgp_access_token")?.value;
  if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const commercial = await enterpriseRpc<CommercialState>(request, "enterprise_account_commercial_state", {
    p_organization_id: access.organizationId,
  });
  if (commercial.response) return commercial.response;

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
  const apiKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? DEFAULT_PUBLISHABLE_KEY;
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: apiKey, authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!userResponse.ok) return NextResponse.json({ error: "Tu sesión expiró. Ingresa nuevamente." }, { status: 401 });

  const user = await userResponse.json() as {
    id?: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
  const metadata = user.user_metadata ?? {};
  const displayName = typeof metadata.display_name === "string" && metadata.display_name.trim()
    ? metadata.display_name.trim()
    : (user.email?.split("@")[0] ?? "Usuario");

  return NextResponse.json({
    user: {
      id: user.id ?? null,
      email: user.email ?? null,
      displayName,
      phone: typeof metadata.phone === "string" ? metadata.phone : null,
      jobTitle: typeof metadata.job_title === "string" ? metadata.job_title : null,
      company: typeof metadata.company === "string" ? metadata.company : access.organizationName,
    },
    organization: {
      id: access.organizationId,
      name: access.organizationName,
      type: access.organizationType,
      status: access.status,
      plan: access.plan,
      commercialPlan: commercial.data?.commercialPlan ?? null,
      role: access.role,
      industrySlug: access.industrySlug,
      industryName: access.industryName,
      retailers: access.retailers ?? [],
      modules: access.modules ?? [],
      limits: access.limits ?? {},
      commercial: commercial.data ?? null,
      isSaasAdmin: access.isSaasAdmin,
    },
  }, { headers: { "cache-control": "private, no-store" } });
}
