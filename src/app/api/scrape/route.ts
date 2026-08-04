import { NextResponse } from "next/server";
import { runScrapers } from "@/lib/scrapers";
import { supabaseRest } from "@/lib/supabase";

export const maxDuration = 60;

type IngestResult = { products_found: number };

export async function GET() {
  const secret = process.env.SCRAPE_INGEST_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Scraping secret is not configured" }, { status: 500 });
  }

  try {
    const canRun = await supabaseRest<boolean>("rpc/scrape_status", {
      method: "POST",
      body: { p_secret: secret }
    });
    if (!canRun) {
      return NextResponse.json({ error: "A scraping run was completed recently. Try again later." }, { status: 429 });
    }

    const startedAt = new Date().toISOString();
    const { products, errors } = await runScrapers();
    const result = await supabaseRest<IngestResult>("rpc/ingest_scrape", {
      method: "POST",
      body: {
        p_secret: secret,
        p_started_at: startedAt,
        p_products: products.map((item) => ({
          supermarket: item.supermarket,
          external_id: item.externalId,
          name: item.name,
          brand: item.brand ?? null,
          category: item.category ?? null,
          url: item.url,
          image_url: item.imageUrl ?? null,
          regular_price: item.regularPrice ?? null,
          offer_price: item.offerPrice,
          unit: item.unit ?? null,
          unit_price: item.unitPrice ?? null,
          in_stock: item.stock ?? true,
          observed_at: new Date().toISOString()
        })),
        p_errors: errors
      }
    });

    return NextResponse.json({
      ok: errors.length === 0,
      productsFound: result.products_found,
      errors
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
