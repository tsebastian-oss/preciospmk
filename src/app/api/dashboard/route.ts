import { NextResponse } from "next/server";
import { supabaseRest } from "@/lib/supabase";

type Summary = {
  total_products: number;
  in_stock_products: number;
  offers: number;
  supermarkets: number;
  average_price: number;
  total_savings: number;
  last_updated: string | null;
};

type SupermarketSummary = {
  supermarket: string;
  products: number;
  in_stock: number;
  offers: number;
  average_price: number;
  average_discount: number;
  last_updated: string | null;
};

type CategorySummary = {
  supermarket: string;
  category: string;
  products: number;
};

type CrawlRun = {
  id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  tasks_total: number;
  tasks_completed: number;
  tasks_failed: number;
  products_found: number;
  source_counts: Record<string, number>;
  errors: unknown[];
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [summaries, supermarkets, categories, runs, topOffers] = await Promise.all([
      supabaseRest<Summary[]>("dashboard_summary", {
        query: { select: "*", limit: "1" },
      }),
      supabaseRest<SupermarketSummary[]>("dashboard_supermarkets", {
        query: { select: "*", order: "products.desc" },
      }),
      supabaseRest<CategorySummary[]>("dashboard_categories", {
        query: { select: "*", order: "products.desc", limit: "1000" },
      }),
      supabaseRest<CrawlRun[]>("catalog_crawl_runs", {
        query: {
          select: "id,status,started_at,finished_at,tasks_total,tasks_completed,tasks_failed,products_found,source_counts,errors",
          order: "id.desc",
          limit: "1",
        },
      }),
      supabaseRest<unknown[]>("dashboard_products", {
        query: {
          select: "id,supermarket,external_id,name,brand,category,url,image_url,regular_price,offer_price,unit,unit_price,in_stock,observed_at,savings,discount_pct",
          discount_pct: "gt.0",
          order: "discount_pct.desc,savings.desc",
          limit: "8",
        },
      }),
    ]);

    return NextResponse.json({
      summary: summaries[0] ?? null,
      supermarkets,
      categories,
      run: runs[0] ?? null,
      topOffers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
