import { NextRequest, NextResponse } from "next/server";
import { enterpriseAccess, enterpriseRest } from "@/lib/enterprise-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ChatRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  selected_month: string | null;
  created_at: string;
};

export async function GET(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;
  if (!auth.access) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const result = await enterpriseRest<ChatRow[]>(
    request,
    "b2b_chat_messages",
    {
      method: "GET",
      query: {
        select: "id,role,content,selected_month,created_at",
        organization_id: `eq.${auth.access.organizationId}`,
        module: "eq.courier_b2b",
        order: "created_at.desc",
        limit: "80",
      },
    },
  );

  if (result.response) return result.response;
  const messages = [...(result.data ?? [])].reverse().map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    selectedMonth: row.selected_month,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ messages }, { headers: { "cache-control": "private, no-store, max-age=0" } });
}

export async function DELETE(request: NextRequest) {
  const auth = await enterpriseAccess(request, "overview");
  if (auth.response) return auth.response;
  if (!auth.access) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const result = await enterpriseRest<unknown>(
    request,
    "b2b_chat_messages",
    {
      method: "DELETE",
      query: {
        organization_id: `eq.${auth.access.organizationId}`,
        module: "eq.courier_b2b",
      },
      prefer: "return=minimal",
    },
  );

  if (result.response) return result.response;
  return NextResponse.json({ ok: true });
}
