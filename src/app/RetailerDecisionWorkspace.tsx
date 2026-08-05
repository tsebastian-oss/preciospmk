"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./retailer-decision-workspace.module.css";

export type RetailerDecisionView = "price-image" | "assortment-gaps" | "price-movements" | "basket-simulator";

type Numeric = number | string;
type SupermarketSummary = {
  supermarket: string;
  products: Numeric;
  in_stock: Numeric;
  offers: Numeric;
  average_price: Numeric;
  average_discount: Numeric;
};
type CategorySummary = { supermarket: string; category: string; products: Numeric };
type Listing = { id: string; supermarket: string; name: string; price: Numeric; in_stock: boolean; url: string };
type Match = {
  match_key: string;
  canonical_name: string;
  category: string | null;
  average_price: Numeric;
  best_price: Numeric;
  highest_price: Numeric;
  price_gap: Numeric;
  savings_pct: Numeric;
  store_listings: Listing[];
};
type Product = { id: string; supermarket: string; name: string; brand: string | null; category: string | null; regular_price: Numeric | null; offer_price: Numeric; discount_pct: Numeric; url: string };

type Movement = {
  id: number;
  supermarket: string;
  name: string;
  brand: string;
  category: string;
  change_type: string;
  previousPrice: number;
  currentPrice: number;
  priceDelta: number;
  priceDeltaPct: number;
  detected_at: string;
};
type MovementPayload = {
  changes: Movement[];
  summary: { total: number; priceChanges: number; priceIncreases: number; priceDecreases: number; stockChanges: number };
  baselineReady: boolean;
  error?: string;
};

const RETAILERS = ["Lider", "Jumbo", "Santa Isabel"];
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat("es-CL");

function value(input: Numeric | null | undefined) {
  const parsed = Number(input ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedCategory(category: string) {
  return category
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[>\/|]/)
    .at(-1)
    ?.replace(/[^a-z0-9]+/g, " ")
    .trim() || "sin categoria";
}

function storeTone(index: number) {
  if (index <= 97) return "good";
  if (index <= 103) return "neutral";
  if (index <= 108) return "warning";
  return "risk";
}

export default function RetailerDecisionWorkspace({
  view,
  supermarkets,
  categories,
  matches,
  topOffers,
}: {
  view: RetailerDecisionView;
  supermarkets: SupermarketSummary[];
  categories: CategorySummary[];
  matches: Match[];
  topOffers: Product[];
}) {
  const [selectedBasket, setSelectedBasket] = useState<string[]>([]);
  const [movements, setMovements] = useState<MovementPayload | null>(null);
  const [movementLoading, setMovementLoading] = useState(false);

  useEffect(() => {
    if (view !== "price-movements" || movements || movementLoading) return;
    setMovementLoading(true);
    fetch("/api/price-movements", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as MovementPayload;
        if (!response.ok) throw new Error(payload.error || "No fue posible cargar movimientos");
        setMovements(payload);
      })
      .catch((error) => setMovements({ changes: [], summary: { total: 0, priceChanges: 0, priceIncreases: 0, priceDecreases: 0, stockChanges: 0 }, baselineReady: false, error: error instanceof Error ? error.message : String(error) }))
      .finally(() => setMovementLoading(false));
  }, [view, movements, movementLoading]);

  useEffect(() => {
    if (selectedBasket.length || !matches.length) return;
    setSelectedBasket(matches.slice(0, 6).map((match) => match.match_key));
  }, [matches, selectedBasket.length]);

  const priceImage = useMemo(() => RETAILERS.map((retailer) => {
    const indices: number[] = [];
    let cheap = 0;
    let aligned = 0;
    let expensive = 0;
    for (const match of matches) {
      const listing = match.store_listings.find((item) => item.supermarket === retailer && item.in_stock);
      const benchmark = value(match.average_price);
      const listingPrice = value(listing?.price);
      if (!listing || benchmark <= 0 || listingPrice <= 0) continue;
      const index = listingPrice / benchmark * 100;
      indices.push(index);
      if (index < 97) cheap += 1;
      else if (index <= 103) aligned += 1;
      else expensive += 1;
    }
    const index = indices.length ? indices.reduce((sum, item) => sum + item, 0) / indices.length : 0;
    return { retailer, index, cheap, aligned, expensive, coverage: indices.length };
  }), [matches]);

  const categoryIndex = useMemo(() => {
    const rows = new Map<string, Record<string, number[]>>();
    for (const match of matches) {
      const category = match.category || "Sin categoría";
      const benchmark = value(match.average_price);
      if (benchmark <= 0) continue;
      const record = rows.get(category) ?? {};
      for (const listing of match.store_listings) {
        if (!listing.in_stock || value(listing.price) <= 0) continue;
        record[listing.supermarket] = record[listing.supermarket] ?? [];
        record[listing.supermarket].push(value(listing.price) / benchmark * 100);
      }
      rows.set(category, record);
    }
    return [...rows.entries()].map(([category, stores]) => ({
      category,
      stores: Object.fromEntries(Object.entries(stores).map(([store, indices]) => [store, indices.reduce((sum, item) => sum + item, 0) / indices.length])),
      coverage: Object.values(stores).reduce((sum, items) => sum + items.length, 0),
    })).sort((left, right) => right.coverage - left.coverage).slice(0, 12);
  }, [matches]);

  const assortmentMatrix = useMemo(() => {
    const map = new Map<string, { label: string; stores: Record<string, number> }>();
    for (const row of categories) {
      const key = normalizedCategory(row.category);
      const current = map.get(key) ?? { label: row.category, stores: {} };
      current.stores[row.supermarket] = (current.stores[row.supermarket] ?? 0) + value(row.products);
      map.set(key, current);
    }
    return [...map.values()]
      .filter((item) => Object.keys(item.stores).length >= 2)
      .map((item) => {
        const counts = RETAILERS.map((retailer) => item.stores[retailer] ?? 0);
        const max = Math.max(...counts);
        const minPositive = Math.min(...counts.filter((count) => count > 0));
        return { ...item, max, gap: max - (Number.isFinite(minPositive) ? minPositive : 0) };
      })
      .sort((left, right) => right.gap - left.gap)
      .slice(0, 18);
  }, [categories]);

  const selectedMatches = matches.filter((match) => selectedBasket.includes(match.match_key));
  const basketTotals = RETAILERS.map((retailer) => {
    let total = 0;
    let available = 0;
    for (const match of selectedMatches) {
      const listing = match.store_listings.find((item) => item.supermarket === retailer && item.in_stock);
      if (!listing) continue;
      total += value(listing.price);
      available += 1;
    }
    return { retailer, total, available, complete: available === selectedMatches.length };
  });
  const validBasketTotals = basketTotals.filter((item) => item.available > 0);
  const bestBasket = [...validBasketTotals].sort((left, right) => left.total - right.total)[0];

  if (view === "price-image") {
    return <section className={styles.workspace}>
      <div className={styles.intro}><div><span>PRICE IMAGE INDEX</span><h2>¿Qué tan cara o barata se ve cada cadena?</h2></div><p>El índice usa productos equivalentes del matching actual. Mercado = 100. Menos de 97 es competitivo; sobre 103 indica prima.</p></div>
      <div className={styles.indexCards}>{priceImage.map((item) => <article key={item.retailer} className={styles[storeTone(item.index)]}><span>{item.retailer}</span><strong>{item.index ? item.index.toFixed(1) : "—"}</strong><p>{item.index ? `${Math.abs(item.index - 100).toFixed(1)}% ${item.index >= 100 ? "sobre" : "bajo"} mercado` : "Sin cobertura suficiente"}</p><div><b>{item.cheap} bajos</b><b>{item.aligned} alineados</b><b>{item.expensive} altos</b></div><small>{item.coverage} matches utilizados</small></article>)}</div>
      <article className={styles.panel}><div className={styles.panelHead}><div><span>CATEGORY PRICE IMAGE</span><h3>Índice por categoría y cadena</h3></div><small>Basado en la muestra de matches cargada</small></div><div className={styles.tableWrap}><table><thead><tr><th>Categoría</th>{RETAILERS.map((retailer) => <th key={retailer}>{retailer}</th>)}<th>Cobertura</th></tr></thead><tbody>{categoryIndex.map((row) => <tr key={row.category}><td><strong>{row.category}</strong></td>{RETAILERS.map((retailer) => <td key={retailer}><b className={styles[storeTone(row.stores[retailer] ?? 100)]}>{row.stores[retailer] ? row.stores[retailer].toFixed(1) : "—"}</b></td>)}<td>{row.coverage}</td></tr>)}</tbody></table></div></article>
      <article className={styles.insight}><span>LECTURA EJECUTIVA</span><strong>{priceImage.filter((item) => item.index > 103).length ? `${priceImage.sort((a,b)=>b.index-a.index)[0]?.retailer} presenta la mayor prima dentro de la muestra.` : "Las cadenas están razonablemente alineadas dentro de la muestra actual."}</strong><p>El próximo nivel será ponderar los SKU por sensibilidad de precio y construir un índice KVI, no solo un promedio simple.</p></article>
    </section>;
  }

  if (view === "assortment-gaps") {
    return <section className={styles.workspace}>
      <div className={styles.intro}><div><span>ASSORTMENT GAPS</span><h2>Brechas comparables de profundidad de surtido.</h2></div><p>Se muestran solo categorías homologables presentes en al menos dos cadenas; se excluye el ranking bruto que mezclaba taxonomías no comparables.</p></div>
      <div className={styles.metricGrid}>{supermarkets.map((store) => <article key={store.supermarket}><span>{store.supermarket}</span><strong>{integer.format(value(store.products))}</strong><small>{integer.format(value(store.in_stock))} disponibles · {integer.format(value(store.offers))} promociones</small></article>)}</div>
      <article className={styles.panel}><div className={styles.panelHead}><div><span>CATEGORY COVERAGE MATRIX</span><h3>Dónde existe una brecha accionable</h3></div><small>{assortmentMatrix.length} categorías homologadas</small></div><div className={styles.tableWrap}><table><thead><tr><th>Categoría</th>{RETAILERS.map((retailer) => <th key={retailer}>{retailer}</th>)}<th>Brecha</th><th>Líder</th></tr></thead><tbody>{assortmentMatrix.map((row) => { const leader = RETAILERS.sort((a,b)=>(row.stores[b]??0)-(row.stores[a]??0))[0]; return <tr key={row.label}><td><strong>{row.label}</strong></td>{RETAILERS.map((retailer) => <td key={retailer}>{integer.format(row.stores[retailer] ?? 0)}</td>)}<td><b>{integer.format(row.gap)} SKU</b></td><td>{leader}</td></tr>; })}</tbody></table></div>{!assortmentMatrix.length && <div className={styles.empty}>La taxonomía de las cadenas todavía no permite homologar suficientes categorías. El sistema mantendrá esta vista vacía antes que mostrar comparaciones engañosas.</div>}</article>
      <article className={styles.insight}><span>POR QUÉ ESTA VISTA ES MEJOR</span><strong>La oportunidad no es “quién tiene más categorías”, sino qué marcas, formatos y SKU faltan dentro de una categoría comparable.</strong><p>La siguiente capa conectará el matching de productos para listar referencias exclusivas y oportunidades concretas de incorporación.</p></article>
    </section>;
  }

  if (view === "price-movements") {
    const summary = movements?.summary;
    return <section className={styles.workspace}>
      <div className={styles.intro}><div><span>PRICE MOVEMENT MONITOR</span><h2>Quién movió precio, cuánto y cuándo.</h2></div><p>La vista se alimenta del diferencial entre corridas completas. La línea base no genera falsos cambios; el historial comienza con la siguiente corrida completada.</p></div>
      <div className={styles.metricGrid}><article><span>Cambios detectados</span><strong>{movementLoading ? "—" : integer.format(summary?.total ?? 0)}</strong><small>Última comparación disponible</small></article><article><span>Subidas</span><strong>{integer.format(summary?.priceIncreases ?? 0)}</strong><small>Aumentos de precio</small></article><article><span>Bajadas</span><strong>{integer.format(summary?.priceDecreases ?? 0)}</strong><small>Reducciones de precio</small></article><article><span>Stock</span><strong>{integer.format(summary?.stockChanges ?? 0)}</strong><small>Cambios de disponibilidad</small></article></div>
      {movementLoading ? <div className={styles.empty}>Cargando movimientos…</div> : !movements?.baselineReady ? <article className={styles.baseline}><span>BASELINE EN CONSTRUCCIÓN</span><h3>El módulo está listo, pero todavía no existe una corrida completa posterior para comparar.</h3><p>Cuando termine la siguiente captura diaria, aquí aparecerán subidas, bajadas, cambios de stock, productos nuevos, retirados y reactivados.</p></article> : <article className={styles.panel}><div className={styles.panelHead}><div><span>LATEST MOVEMENTS</span><h3>Cambios recientes</h3></div></div><div className={styles.tableWrap}><table><thead><tr><th>Producto</th><th>Cadena</th><th>Antes</th><th>Ahora</th><th>Movimiento</th><th>Detectado</th></tr></thead><tbody>{movements.changes.slice(0,80).map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.brand || item.category}</small></td><td>{item.supermarket}</td><td>{item.previousPrice ? money.format(item.previousPrice) : "—"}</td><td>{item.currentPrice ? money.format(item.currentPrice) : "—"}</td><td><b className={item.priceDelta > 0 ? styles.risk : styles.good}>{item.priceDelta ? `${item.priceDelta > 0 ? "+" : ""}${item.priceDeltaPct.toFixed(1)}%` : item.change_type}</b></td><td>{new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short"}).format(new Date(item.detected_at))}</td></tr>)}</tbody></table></div></article>}
    </section>;
  }

  return <section className={styles.workspace}>
    <div className={styles.intro}><div><span>SMART BASKET SIMULATOR</span><h2>Convierte el matching en una comparación de compra completa.</h2></div><p>Selecciona productos equivalentes y compara el costo total por cadena, incluyendo disponibilidad y faltantes.</p></div>
    <div className={styles.basketLayout}>
      <article className={styles.panel}><div className={styles.panelHead}><div><span>PRODUCT SELECTION</span><h3>Arma la canasta</h3></div><small>{selectedMatches.length} productos</small></div><div className={styles.basketProducts}>{matches.slice(0,18).map((match) => <label key={match.match_key}><input type="checkbox" checked={selectedBasket.includes(match.match_key)} onChange={(event) => setSelectedBasket((current) => event.target.checked ? [...current,match.match_key] : current.filter((key) => key !== match.match_key))} /><span><strong>{match.canonical_name}</strong><small>{match.category || "Sin categoría"}</small></span><b>{money.format(value(match.average_price))}</b></label>)}</div></article>
      <div className={styles.basketTotals}>{basketTotals.map((item) => <article key={item.retailer} className={bestBasket?.retailer === item.retailer ? styles.winner : ""}><span>{item.retailer}</span><strong>{item.total ? money.format(item.total) : "—"}</strong><p>{item.available}/{selectedMatches.length} productos disponibles</p>{bestBasket?.retailer === item.retailer && <b>Mejor canasta</b>}</article>)}<article className={styles.basketInsight}><span>BRECHA DE CANASTA</span><strong>{validBasketTotals.length > 1 ? money.format(Math.max(...validBasketTotals.map((item)=>item.total))-Math.min(...validBasketTotals.map((item)=>item.total))) : "—"}</strong><p>Diferencia entre la cadena más barata y la más cara para la selección actual.</p></article></div>
    </div>
    {topOffers.length > 0 && <article className={styles.panel}><div className={styles.panelHead}><div><span>PROMOTIONAL CONTEXT</span><h3>Promociones destacadas que podrían cambiar la canasta</h3></div></div><div className={styles.offerStrip}>{topOffers.slice(0,6).map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.id}><span>{item.supermarket}</span><strong>{item.name}</strong><b>-{value(item.discount_pct).toFixed(0)}%</b></a>)}</div></article>}
  </section>;
}
