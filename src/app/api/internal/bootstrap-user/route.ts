import { NextRequest, NextResponse } from "next/server";

const BOOTSTRAP_TOKEN = "mgp-bootstrap-7f2d9c4a1e6b";

export async function POST(request: NextRequest) {
  if (request.headers.get("x-bootstrap-token") !== BOOTSTRAP_TOKEN) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Configuración incompleta" }, { status: 500 });
  }

  const body = await request.json() as { password?: string };
  if (!body.password) {
    return NextResponse.json({ error: "Falta contraseña" }, { status: 400 });
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: "mazokin13@mgp-retail.internal",
      password: body.password,
      email_confirm: true,
      user_metadata: { username: "mazokin13", display_name: "Mazokin13" },
      app_metadata: { role: "admin" },
    }),
    cache: "no-store",
  });

  const payload = await response.json();
  if (!response.ok) {
    return NextResponse.json({ error: payload }, { status: response.status });
  }

  return NextResponse.json({ ok: true, user_id: payload.id, email: payload.email });
}
