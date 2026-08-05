import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

type RuntimeConfig = {
  provider?: "resend" | "brevo";
  from_email?: string | null;
  from_name?: string | null;
  enabled?: boolean;
  api_key?: string | null;
  dispatch_token?: string | null;
};
type Delivery = {
  id: number;
  organization_id: string;
  alert_event_id: number;
  channel: "email" | "in_app" | "slack" | "teams";
  recipient: string;
  status: string;
  attempts: number;
  alert_events: { title: string; message: string; severity: string; alert_type: string; detected_at: string };
  organizations: { name: string };
};

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_configuration_error" }, 500);

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: runtimeData, error: runtimeError } = await service.rpc("get_notification_runtime_config_service");
  if (runtimeError) return json({ error: "runtime_config_error", detail: runtimeError.message }, 500);
  const config = runtimeData as RuntimeConfig;
  const dispatchToken = request.headers.get("x-dispatch-token");
  if (!dispatchToken || !config.dispatch_token || dispatchToken !== config.dispatch_token) {
    return json({ error: "forbidden" }, 403);
  }

  const now = new Date().toISOString();
  const { data, error } = await service
    .from("notification_deliveries")
    .select("id,organization_id,alert_event_id,channel,recipient,status,attempts,alert_events!inner(title,message,severity,alert_type,detected_at),organizations!inner(name)")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", now)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) return json({ error: "delivery_query_error", detail: error.message }, 500);

  const deliveries = (data ?? []) as unknown as Delivery[];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const delivery of deliveries) {
    const attempts = Number(delivery.attempts ?? 0) + 1;
    await service.from("notification_deliveries").update({ status: "processing", attempts, updated_at: new Date().toISOString() }).eq("id", delivery.id);

    if (delivery.channel === "in_app") {
      await service.from("notification_deliveries").update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", delivery.id);
      sent += 1;
      continue;
    }

    if (delivery.channel !== "email") {
      await service.from("notification_deliveries").update({ status: "skipped", last_error: `${delivery.channel}_provider_not_configured`, updated_at: new Date().toISOString() }).eq("id", delivery.id);
      skipped += 1;
      continue;
    }

    if (!config.enabled || !config.api_key || !config.from_email || !delivery.recipient.includes("@")) {
      await service.from("notification_deliveries").update({ status: "skipped", last_error: "email_provider_not_configured", updated_at: new Date().toISOString() }).eq("id", delivery.id);
      skipped += 1;
      continue;
    }

    const event = delivery.alert_events;
    const organization = delivery.organizations;
    const subject = `[${event.severity.toUpperCase()}] ${event.title}`;
    const html = `<!doctype html><html><body style="margin:0;background:#f4f4f7;font-family:Arial,sans-serif;color:#171723"><div style="max-width:640px;margin:0 auto;padding:28px"><div style="background:#11111d;border-radius:18px;padding:26px;color:#fff"><div style="font-size:11px;letter-spacing:.12em;color:#d987f4;font-weight:700">MGP INTELLIGENCE · ${escapeHtml(organization.name)}</div><h1 style="font-size:24px;margin:16px 0 10px">${escapeHtml(event.title)}</h1><p style="font-size:15px;line-height:1.65;color:#c8c7d2">${escapeHtml(event.message)}</p><div style="margin-top:20px;padding:12px;border-radius:10px;background:#1b1b2a;font-size:12px;color:#aaa9b6">Tipo: ${escapeHtml(event.alert_type)} · Severidad: ${escapeHtml(event.severity)} · Detectado: ${escapeHtml(event.detected_at)}</div><a href="https://preciospmk.vercel.app" style="display:inline-block;margin-top:22px;padding:12px 16px;border-radius:10px;background:#8b5cf6;color:#fff;text-decoration:none;font-weight:700">Abrir plataforma</a></div></div></body></html>`;

    try {
      let providerResponse: Response;
      if (config.provider === "brevo") {
        providerResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": config.api_key, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            sender: { email: config.from_email, name: config.from_name || "MGP Intelligence" },
            to: [{ email: delivery.recipient }],
            subject,
            htmlContent: html,
          }),
        });
      } else {
        providerResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${config.api_key}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: `${config.from_name || "MGP Intelligence"} <${config.from_email}>`,
            to: [delivery.recipient],
            subject,
            html,
          }),
        });
      }

      const responseText = await providerResponse.text();
      let providerId: string | null = null;
      try {
        const parsed = JSON.parse(responseText) as { id?: string; messageId?: string };
        providerId = parsed.id ?? parsed.messageId ?? null;
      } catch {
        // Provider returned a non-JSON error body.
      }
      if (!providerResponse.ok) throw new Error(`${providerResponse.status}: ${responseText.slice(0, 500)}`);

      await service.from("notification_deliveries").update({
        status: "sent",
        provider_message_id: providerId,
        sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", delivery.id);
      sent += 1;
    } catch (cause) {
      const retryMinutes = Math.min(360, Math.max(5, 5 * 2 ** Math.min(attempts, 6)));
      await service.from("notification_deliveries").update({
        status: attempts >= 5 ? "failed" : "pending",
        last_error: cause instanceof Error ? cause.message.slice(0, 1000) : "delivery_failed",
        next_attempt_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", delivery.id);
      failed += 1;
    }
  }

  return json({ processed: deliveries.length, sent, failed, skipped, completedAt: new Date().toISOString() });
});
