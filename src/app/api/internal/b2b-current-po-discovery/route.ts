import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const PAGES = [
  { id: "DGMN_CORREOS_2026", qs: "g+I77CTckTMeO3wa8djvMg==" },
  { id: "SERVEL_CORREOS_2026", qs: "wkuv6LcOAGXf8fRhBsHgog==" },
  { id: "UCHILE_CHILEXPRESS_2026", qs: "GTqG5Lakm1f3LPMCNzh0+g==" },
] as const;

function decode(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
function text(value: string) {
  return decode(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export async function GET() {
  const results: Array<Record<string, unknown>> = [];
  for (const page of PAGES) {
    const url = `https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?qs=${encodeURIComponent(page.qs)}`;
    try {
      const response = await fetch(url, { cache: "no-store", headers: { "user-agent": "Mozilla/5.0", accept: "text/html" } });
      const html = await response.text();
      const attachmentQs = html.match(/ViewAttachmentPurchaseOrder\.aspx\?qs=([^'"&<]+)/i)?.[1] ?? null;
      const rows: Array<{ control: string; rut: string | null }> = [];
      for (const match of html.matchAll(/id=["']gvCotizacion_(ctl\d+)_lblRutData["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?id=["']gvCotizacion_\1_lnkAdjunto["'][^>]*href=["']javascript:__doPostBack\(&#39;([^&']+)[^"']*/gi)) {
        rows.push({ control: decode(match[3]), rut: text(match[2]) || null });
      }
      const name = text(html.match(/id=["']lblNamePOValue["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
      const supplier = text(html.match(/id=["']lblProviderNameValue["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? html.match(/id=["']lblNameSupplierValue["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
      const plain = text(html);
      const signalAt = Math.max(plain.toLowerCase().indexOf("tarifario"), plain.toLowerCase().indexOf("peso y valor"));
      const signal = signalAt >= 0 ? plain.slice(Math.max(0, signalAt - 700), signalAt + 1700) : null;
      results.push({ id: page.id, status: response.status, name, supplier, attachmentQs, quoteControls: rows, signal });
    } catch (error) {
      results.push({ id: page.id, error: error instanceof Error ? error.message : "discovery error" });
    }
  }
  return NextResponse.json({ ok: true, results }, { headers: { "cache-control": "no-store" } });
}
