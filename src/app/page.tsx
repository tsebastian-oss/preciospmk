"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Product = {
  id?: string;
  name: string;
  brand?: string | null;
  supermarket: string;
  offer_price: number;
  regular_price?: number | null;
  observed_at?: string;
};

const fallback: Product[] = [
  { name: "Leche entera 1L", brand: "Colun", supermarket: "Lider", offer_price: 1090, regular_price: 1190 },
  { name: "Arroz grado 2 1kg", brand: "Tucapel", supermarket: "Unimarc", offer_price: 1690, regular_price: 1790 },
  { name: "Aceite vegetal 1L", brand: "Chef", supermarket: "Jumbo", offer_price: 1890, regular_price: 1890 },
  { name: "Detergente líquido 3L", brand: "Ariel", supermarket: "Santa Isabel", offer_price: 6990, regular_price: 7990 }
];

function money(value: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>(fallback);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [message, setMessage] = useState("Datos demo mientras se ejecuta el primer scraping.");

  const loadProducts = useCallback(async (term = "") => {
    setLoading(true);
    try {
      const response = await fetch(`/api/products${term ? `?q=${encodeURIComponent(term)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("La base de datos aún no está disponible");
      const payload = await response.json() as { products?: Product[] };
      if (payload.products?.length) {
        setProducts(payload.products);
        setMessage(`${payload.products.length} productos encontrados en la última actualización.`);
      } else {
        setProducts(fallback);
        setMessage("Aún no hay productos almacenados. Ejecuta el primer scraping.");
      }
    } catch {
      setProducts(fallback);
      setMessage("Mostrando datos demo hasta completar la conexión con Supabase.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  async function search(event: FormEvent) {
    event.preventDefault();
    await loadProducts(query.trim());
  }

  async function runScrape() {
    setScraping(true);
    setMessage("Extrayendo precios de los supermercados...");
    try {
      const response = await fetch("/api/scrape", { cache: "no-store" });
      const payload = await response.json() as { productsFound?: number; errors?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "No fue posible ejecutar el scraping");
      setMessage(`Scraping terminado: ${payload.productsFound ?? 0} productos detectados${payload.errors?.length ? `, ${payload.errors.length} avisos` : ""}.`);
      await loadProducts(query.trim());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Error al ejecutar el scraping");
    } finally {
      setScraping(false);
    }
  }

  const supermarkets = new Set(products.map((product) => product.supermarket)).size;
  const offers = products.filter((product) => product.regular_price && product.regular_price > product.offer_price).length;

  return <main>
    <header>
      <div>
        <div className="eyebrow">MGP GROWTH INTELLIGENCE</div>
        <h1>Super Precios Chile</h1>
        <p className="sub">Monitorea precios, promociones y variaciones históricas de supermercados chilenos desde un solo lugar.</p>
      </div>
      <button onClick={runScrape} disabled={scraping}>{scraping ? "Procesando…" : "Ejecutar scraping"}</button>
    </header>

    <section className="grid">
      <div className="card"><span className="sub">Productos mostrados</span><div className="metric">{products.length.toLocaleString("es-CL")}</div></div>
      <div className="card"><span className="sub">Supermercados</span><div className="metric">{supermarkets}</div></div>
      <div className="card"><span className="sub">Ofertas detectadas</span><div className="metric">{offers}</div></div>
      <div className="card"><span className="sub">Estado</span><div className="metric status">{loading ? "Actualizando" : "Activo"}</div></div>
    </section>

    <form className="toolbar" onSubmit={search}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca arroz, leche, detergente..." aria-label="Buscar producto" />
      <button type="submit" disabled={loading}>{loading ? "Buscando…" : "Buscar"}</button>
    </form>

    <p className="notice">{message}</p>

    <section className="panel">
      <h2>Mejores precios detectados</h2>
      <table>
        <thead><tr><th>Producto</th><th>Marca</th><th>Supermercado</th><th>Precio oferta</th><th>Ahorro</th></tr></thead>
        <tbody>{products.map((item, index) => {
          const saving = item.regular_price && item.regular_price > item.offer_price
            ? Math.round((1 - item.offer_price / item.regular_price) * 100)
            : 0;
          return <tr key={item.id ?? `${item.supermarket}-${item.name}-${index}`}>
            <td>{item.name}</td>
            <td>{item.brand ?? "—"}</td>
            <td><span className="badge">{item.supermarket}</span></td>
            <td><strong>{money(Number(item.offer_price))}</strong></td>
            <td className={saving > 0 ? "green" : ""}>{saving > 0 ? `-${saving}%` : "—"}</td>
          </tr>;
        })}</tbody>
      </table>
    </section>
  </main>;
}
