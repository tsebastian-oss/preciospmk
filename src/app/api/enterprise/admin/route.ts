import { NextRequest, NextResponse } from "next/server";
import { enterpriseJson, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

type AdminAction =
  | { action: "createOrganization"; name: string; slug: string; organizationType: string; plan: string; ownerEmail?: string }
  | { action: "updateOrganization"; organizationId: string; name?: string; status?: string; plan?: string; organizationType?: string }
  | { action: "captureDataQuality"; organizationId?: string | null };

export async function GET(request: NextRequest) {
  return enterpriseJson(await enterpriseRpc(request, "enterprise_admin_overview"));
}

export async function POST(request: NextRequest) {
  let payload: AdminAction;
  try {
    payload = await request.json() as AdminAction;
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  if (payload.action === "createOrganization") {
    const slug = payload.slug.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (payload.name.trim().length < 2 || !slug) {
      return NextResponse.json({ error: "Nombre y slug son obligatorios" }, { status: 400 });
    }
    return enterpriseJson(await enterpriseRpc(request, "enterprise_create_organization", {
      p_name: payload.name,
      p_slug: slug,
      p_type: payload.organizationType,
      p_plan: payload.plan,
      p_owner_email: payload.ownerEmail?.trim() || null,
    }));
  }

  if (payload.action === "updateOrganization") {
    return enterpriseJson(await enterpriseRpc(request, "enterprise_update_organization", {
      p_organization_id: payload.organizationId,
      p_name: payload.name ?? null,
      p_status: payload.status ?? null,
      p_plan: payload.plan ?? null,
      p_type: payload.organizationType ?? null,
    }));
  }

  if (payload.action === "captureDataQuality") {
    return enterpriseJson(await enterpriseRpc(request, "enterprise_capture_data_quality", {
      p_organization_id: payload.organizationId ?? null,
    }));
  }

  return NextResponse.json({ error: "Acción no soportada" }, { status: 400 });
}
