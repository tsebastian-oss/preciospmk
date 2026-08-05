import { NextRequest, NextResponse } from "next/server";
import { enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

type Organization = { id: string; status: string };
type ContextData = {
  user?: { lastOrganizationId?: string | null };
  organizations?: Organization[];
  activeOrganizationId?: string | null;
};

function organizationCookie(response: NextResponse, organizationId: string) {
  response.cookies.set("mgp_organization_id", organizationId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const result = await enterpriseRpc<ContextData>(request, "enterprise_context");
  if (result.response) return result.response;
  const data = result.data ?? {};
  const organizations = data.organizations ?? [];
  const cookieOrganization = request.cookies.get("mgp_organization_id")?.value;
  const activeOrganizationId = organizations.find((item) => item.id === cookieOrganization)?.id
    ?? organizations.find((item) => item.id === data.user?.lastOrganizationId)?.id
    ?? organizations.find((item) => ["active", "trial"].includes(item.status))?.id
    ?? organizations[0]?.id
    ?? null;

  const response = NextResponse.json({ ...data, activeOrganizationId });
  return activeOrganizationId ? organizationCookie(response, activeOrganizationId) : response;
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => ({})) as { organizationId?: string };
  if (!payload.organizationId) {
    return NextResponse.json({ error: "Falta organizationId" }, { status: 400 });
  }
  const result = await enterpriseRpc(request, "enterprise_set_active_organization", {
    p_organization_id: payload.organizationId,
  });
  if (result.response) return result.response;
  return organizationCookie(NextResponse.json({ access: result.data }), payload.organizationId);
}
