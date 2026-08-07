import { NextRequest, NextResponse } from "next/server";
import { supabaseRest } from "@/lib/supabase";

function text(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function multiline(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\r/g, "").trim().slice(0, max);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;

    // Honeypot: bots often populate hidden fields. Return success without storing anything.
    if (text(body.website, 120)) return NextResponse.json({ ok: true });

    const startedAt = Number(body.startedAt ?? 0);
    if (Number.isFinite(startedAt) && startedAt > 0 && Date.now() - startedAt < 1200) {
      return NextResponse.json({ ok: true });
    }

    const name = text(body.name, 120);
    const email = text(body.email, 180).toLowerCase();
    const phone = text(body.phone, 40);
    const company = text(body.company, 140);
    const role = text(body.role, 120);
    const industry = text(body.industry, 100);
    const message = multiline(body.message, 2000);
    const preferredDate = text(body.preferredDate, 10);
    const preferredTime = text(body.preferredTime, 80);

    if (name.length < 2) return NextResponse.json({ error: "Ingresa tu nombre." }, { status: 400 });
    if (!validEmail(email)) return NextResponse.json({ error: "Ingresa un correo válido." }, { status: 400 });
    if (!company) return NextResponse.json({ error: "Ingresa tu empresa." }, { status: 400 });
    if (message.length < 5) return NextResponse.json({ error: "Cuéntanos brevemente qué necesitas." }, { status: 400 });
    if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) return NextResponse.json({ error: "Fecha preferida inválida." }, { status: 400 });

    await supabaseRest<string>("rpc/submit_marketing_lead", {
      method: "POST",
      body: {
        p_name: name,
        p_email: email,
        p_phone: phone || null,
        p_company: company,
        p_role: role || null,
        p_industry: industry || null,
        p_message: message,
        p_preferred_date: preferredDate || null,
        p_preferred_time: preferredTime || null,
      },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible registrar la solicitud." }, { status: 500 });
  }
}
