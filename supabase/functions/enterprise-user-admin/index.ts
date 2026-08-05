import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" },
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = request.headers.get("authorization");
  if (!authorization) return json({ error: "missing_authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json({ error: "server_configuration_error" }, 500);

  let payload: { organizationId?: string; email?: string; role?: string; redirectTo?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const organizationId = payload.organizationId?.trim();
  const email = payload.email?.trim().toLowerCase();
  const role = payload.role?.trim();
  if (!organizationId || !email || !email.includes("@") || !role) {
    return json({ error: "organization_email_and_role_required" }, 400);
  }

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: invitation, error: invitationError } = await caller.rpc("enterprise_invite_member", {
    p_organization_id: organizationId,
    p_email: email,
    p_role: role,
  });
  if (invitationError) {
    const forbidden = invitationError.message === "forbidden" || invitationError.code === "42501";
    return json({ error: forbidden ? "forbidden" : invitationError.message }, forbidden ? 403 : 400);
  }

  const invitationResult = invitation as { userProvisioned?: boolean } | null;
  if (invitationResult?.userProvisioned) {
    return json({ invitation, delivery: "existing_user_provisioned" });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const fallbackSite = Deno.env.get("SITE_URL") || "https://preciospmk.vercel.app";
  const redirectTo = payload.redirectTo?.startsWith("https://")
    ? payload.redirectTo
    : `${fallbackSite.replace(/\/$/, "")}/login`;

  const { data: invitedUser, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { organization_id: organizationId, organization_role: role, invited_from: "mgp_enterprise_control" },
  });
  if (inviteError) {
    return json({ error: "email_invitation_failed", detail: inviteError.message, invitation }, 502);
  }

  return json({
    invitation,
    delivery: "email_sent",
    invitedUserId: invitedUser.user?.id ?? null,
  });
});
