import { NextRequest, NextResponse } from "next/server";
import { runScrapers } from "@/lib/scrapers";
import { supabaseRest } from "@/lib/supabase";

export const maxDuration = 60;

type ProductRow = { id: string };

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const { products, errors } = await runScrapers();

  for (const item of products) {
    try {
      const rows = await supabaseRest<ProductRow[]>("products", {
        method: "POST",
        query: { on_conflict: "supermarket,external_id", select: "id" },
        prefer: "resolution=merge-duplicates,return=representation",
        body: {
          supermarket: item.supermarket,
          external_id: item.externalId,
          name: item.name,
          brand: item.brand ?? null,
          category: item.category ?? null,
          url: item.url,
          image_url: item.imageUrl ?? null,
          updated_at: new Date().toISOString()
        }
      });
      const product = rows[0];
      if (!product) throw new Error("Product upsert returned no row");
      await supabaseRest("price_observations", {
        method: "POST",
        prefer: "return=minimal",
        body: {
          product_id: product.id,
          regular_price: item.regularPrice ?? null,
          offer_price: item.offerPrice,
          unit: item.unit ?? null,
          unit_price: item.unitPrice ?? null,
          in_stock: item.stock ?? true,
          observed_at: new Date().toISOString()
        }
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    await supabaseRest("scrape_runs", {
      method: "POST",
      prefer: "return=minimal",
      body: {
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        products_found: products.length,
        errors
      }
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return NextResponse.json({ ok: errors.length === 0, productsFound: products.length, errors });
}
