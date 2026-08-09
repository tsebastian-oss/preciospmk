import { NextRequest, NextResponse } from "next/server";
import { enterpriseRpc } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";

type LeadInbox = { summary?: Record<string, number>; leads?: unknown[] };

export async function GET(request: NextRequest) {
  const result = await enterpriseRpc<LeadInbox>(request, "admin_marketing_leads");
  if (result.response) return result.response;
  return NextResponse.json(result.data ?? { summary: {}, leads: [] }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { id?: unknown; status?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!id || !["new", "contacted", "qualified", "closed"].includes(status)) {
    return NextResponse.json({ error: "Lead o estado inválido." }, { status: 400 });
  }
  const result = await enterpriseRpc(request, "admin_update_marketing_lead", { p_id: id, p_status: status });
  if (result.response) return result.response;
  return NextResponse.json(result.data ?? { ok: true });
}
