import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type City = Record<string, unknown>;

function codeOf(city: City | null) {
  if (!city) return null;
  for (const key of ["code_dls","codigo","id","code","value"]) {
    const value = city[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return null;
}

function findCity(list: City[], name: string) {
  const target = name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  return list.find((row) => {
    const text = JSON.stringify(row).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
    return text.includes(target);
  }) ?? null;
}

export async function GET() {
  try {
    const headers = { "user-agent": "Mozilla/5.0", accept: "application/json" };
    const cityResponse = await fetch("https://gateway.starken.cl/agency/city", { headers, cache: "no-store", signal: AbortSignal.timeout(15000) });
    const cityText = await cityResponse.text();
    let cityPayload: any = null;
    try { cityPayload = JSON.parse(cityText); } catch {}
    const list: City[] = Array.isArray(cityPayload) ? cityPayload : Array.isArray(cityPayload?.data) ? cityPayload.data : Array.isArray(cityPayload?.response) ? cityPayload.response : [];
    const santiago = findCity(list,"Santiago");
    const antofagasta = findCity(list,"Antofagasta");
    const quoteBody = {
      alto: 10, ancho: 10, bulto: "PAQUETE", destino: codeOf(antofagasta),
      entrega: "DOMICILIO", kilos: 0.5, largo: 20, origen: codeOf(santiago), servicio: "NORMAL"
    };
    let quoteStatus = 0, quotePayload: any = null;
    if (quoteBody.origen && quoteBody.destino) {
      const q = await fetch("https://gateway.starken.cl/quote/cotizador", {
        method: "POST",
        headers: { "user-agent":"Mozilla/5.0", accept:"application/json", "content-type":"application/json;charset=UTF-8" },
        body: JSON.stringify(quoteBody),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      quoteStatus = q.status;
      const qt = await q.text();
      try { quotePayload = JSON.parse(qt); } catch { quotePayload = qt.slice(0,2000); }
    }
    return NextResponse.json({
      cityStatus: cityResponse.status,
      cityCount: list.length,
      santiago,
      antofagasta,
      quoteBody,
      quoteStatus,
      quotePayload,
    }, { headers: { "cache-control":"no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
