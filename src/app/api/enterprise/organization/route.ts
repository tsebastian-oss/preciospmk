import { NextRequest, NextResponse } from "next/server";
import { enterpriseJson, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.SUPABASE_URL
  ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  ?? "https://yfpixszkiakwzrqdcfbw.supabase.co";

type OrganizationAction =
  | { action: "inviteMember"; organizationId: string; email: string; role: string }
  | { action: "revokeInvitation"; organizationId: string; invitationId: string }
  | { action: "updateMember"; organizationId: string; userId: string; role?: string; status?: string }
  | { action: "updateConfiguration"; organizationId: string; settings?: Record<string, unknown>; scopes?: Record<string, unknown> };

export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (!organizationId) return NextResponse.json({ error: "Falta organizationId" }, { status: 400 });
  return enterpriseJson(await enterpriseRpc(request, "enterprise_organization_detail", {
    p_organization_id: organizationId,
  }));
}

export async function POST(request: NextRequest) {
  let payload: OrganizationAction;
  try {
    payload = await request.json() as OrganizationAction;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  if (payload.action === "inviteMember") {
    if (!payload.email.includes("@")) return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    const accessToken = request.cookies.get("mgp_access_token")?.value;
    if (!accessToken) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const edgeResponse = await fetch(`${SUPABASE_URL}/functions/v1/enterprise-user-admin`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: payload.organizationId,
        email: payload.email.trim().toLowerCase(),
        role: payload.role,
        redirectTo: `${request.nextUrl.origin}/login`,
      }),
      cache: "no-store",
    });
    const result = await edgeResponse.json().catch(() => ({ error: "Respuesta inválida del servicio de invitaciones" })) as {
      error?: string;
      detail?: string;
      delivery?: string;
      invitation?: unknown;
    };
    if (!edgeResponse.ok) {
      const message = result.error === "email_invitation_failed"
        ? `La invitación quedó registrada, pero el correo no pudo enviarse: ${result.detail || "revisa la configuración SMTP"}`
        : result.error || "No fue posible invitar al usuario";
      return NextResponse.json({ error: message }, { status: edgeResponse.status });
    }
    return NextResponse.json(result);
  }

  if (payload.action === "revokeInvitation") {
    return enterpriseJson(await enterpriseRpc(request, "enterprise_revoke_invitation", {
      p_organization_id: payload.organizationId,
      p_invitation_id: payload.invitationId,
    }));
  }

  if (payload.action === "updateMember") {
    return enterpriseJson(await enterpriseRpc(request, "enterprise_update_member", {
      p_organization_id: payload.organizationId,
      p_user_id: payload.userId,
      p_role: payload.role ?? null,
      p_status: payload.status ?? null,
    }));
  }

  if (payload.action === "updateConfiguration") {
    return enterpriseJson(await enterpriseRpc(request, "enterprise_update_configuration", {
      p_organization_id: payload.organizationId,
      p_settings: payload.settings ?? null,
      p_scopes: payload.scopes ?? null,
    }));
  }

  return NextResponse.json({ error: "Acción no soportada" }, { status: 400 });
}
