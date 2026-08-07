import { NextRequest, NextResponse } from "next/server";
import { enterpriseJson, enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return enterpriseJson(await enterpriseRpc(request, "admin_trial_pipeline"));
}

export async function POST(request: NextRequest) {
  let payload: { userId?: string; patch?: Record<string, unknown> };
  try {
    payload = await request.json() as { userId?: string; patch?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  if (!payload.userId || !payload.patch || typeof payload.patch !== "object") {
    return NextResponse.json({ error: "Usuario y cambios son obligatorios" }, { status: 400 });
  }

  return enterpriseJson(await enterpriseRpc(request, "admin_update_trial", {
    p_user_id: payload.userId,
    p_patch: payload.patch,
  }));
}
