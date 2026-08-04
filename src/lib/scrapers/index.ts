import type { ScrapedProduct } from "@/lib/types";
import { scrapeJsonLdCollection } from "./generic";

const TARGETS = [
  { supermarket: "Lider", url: "https://www.lider.cl/supermercado/category/Despensa" },
  { supermarket: "Jumbo", url: "https://www.jumbo.cl/despensa" },
  { supermarket: "Santa Isabel", url: "https://www.santaisabel.cl/despensa" },
  { supermarket: "Unimarc", url: "https://www.unimarc.cl/category/despensa" }
];

export async function runScrapers(): Promise<{ products: ScrapedProduct[]; errors: string[] }> {
  const products: ScrapedProduct[] = [];
  const errors: string[] = [];
  for (const target of TARGETS) {
    try {
      products.push(...await scrapeJsonLdCollection(target.supermarket, target.url));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { products, errors };
}
