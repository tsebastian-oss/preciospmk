import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRest } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TYPES = new Set(["report","analysis","matching","market_public","custom"]);
const SCOPES = new Set(["pricing","raw_pricing","market_public","history"]);

function cleanScopes(value: unknown) {
  if (!Array.isArray(value)) return ["pricing","market_public"];
  const scopes = value.map(String).filter((scope) => SCOPES.has(scope));
  return scopes.length ? Array.from(new Set(scopes)).slice(0, 4) : ["pricing","market_public"];
}

export async function GET(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;
  if (!auth.access) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const agents = await enterpriseRest<any[]>(request, "pricing_task_agents", {
    method: "GET",
    query: {
      select: "id,name,agent_type,objective,instructions,data_scopes,model,status,created_at,updated_at",
      organization_id: `eq.${auth.access.organizationId}`,
      vertical: "eq.courier",
      order: "created_at.desc",
      limit: "50",
    },
  });
  if (agents.response) return agents.response;

  const runs = await enterpriseRest<any[]>(request, "pricing_task_agent_runs", {
    method: "GET",
    query: {
      select: "id,agent_id,status,run_instruction,result_title,result_summary,result_json,model,error_message,started_at,finished_at",
      organization_id: `eq.${auth.access.organizationId}`,
      order: "started_at.desc",
      limit: "100",
    },
  });
  if (runs.response) return runs.response;

  return NextResponse.json({
    agents: agents.data ?? [],
    runs: runs.data ?? [],
  }, { headers: { "cache-control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;
  if (!auth.access) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = String(body?.name ?? "").trim().slice(0, 100);
  const objective = String(body?.objective ?? "").trim().slice(0, 3000);
  const instructions = String(body?.instructions ?? "").trim().slice(0, 6000);
  const agentType = TYPES.has(String(body?.agentType)) ? String(body.agentType) : "custom";
  const dataScopes = cleanScopes(body?.dataScopes);

  if (name.length < 2 || objective.length < 8) {
    return NextResponse.json({ error: "Define un nombre y un objetivo claro para el agente." }, { status: 400 });
  }

  const result = await enterpriseRest<any[]>(request, "pricing_task_agents", {
    method: "POST",
    body: [{
      organization_id: auth.access.organizationId,
      vertical: "courier",
      name,
      agent_type: agentType,
      objective,
      instructions,
      data_scopes: dataScopes,
      model: "gpt-5.6",
      status: "active",
    }],
    prefer: "return=representation",
  });
  if (result.response) return result.response;

  return NextResponse.json({ agent: result.data?.[0] ?? null });
}

export async function DELETE(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;
  if (!auth.access) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Falta id del agente." }, { status: 400 });

  const result = await enterpriseRest<unknown>(request, "pricing_task_agents", {
    method: "DELETE",
    query: {
      id: `eq.${id}`,
      organization_id: `eq.${auth.access.organizationId}`,
    },
    prefer: "return=minimal",
  });
  if (result.response) return result.response;
  return NextResponse.json({ ok: true });
}
