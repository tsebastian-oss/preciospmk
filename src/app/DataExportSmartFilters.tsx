"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./DataExportSmartFilters.module.css";

type CategoryOption = {
  value: string;
  label: string;
  products: number;
  retailers: number;
};

type ProductOption = {
  id: string;
  externalId: string;
  name: string;
  brand: string | null;
  supermarket: string;
  category: string;
  industrySlug: string | null;
};

type FilterPayload = {
  filters?: {
    industrySlug: string | null;
    aiFiltered: boolean;
    categories: CategoryOption[];
    products: ProductOption[];
    productCount: number;
    truncated: boolean;
    limit: number;
  };
  industryName?: string | null;
  error?: string;
};

type Props = {
  supermarket: string;
  category: string;
  selectedProductIds: string[];
  onCategoryChange: (value: string) => void;
  onSelectedProductIdsChange: (ids: string[]) => void;
};

const integer = new Intl.NumberFormat("es-CL");
const MAX_SELECTED_PRODUCTS = 500;

export default function DataExportSmartFilters({
  supermarket,
  category,
  selectedProductIds,
  onCategoryChange,
  onSelectedProductIdsChange,
}: Props) {
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productCount, setProductCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [industryName, setIndustryName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: "1200" });
        if (supermarket) params.set("supermarket", supermarket);
        if (category) params.set("category", category);
        if (category && search.trim()) params.set("q", search.trim());
        const response = await fetch(`/api/data-export-filters?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as FilterPayload;
        if (!response.ok || !payload.filters) throw new Error(payload.error || "No fue posible cargar los filtros inteligentes");
        setCategories(payload.filters.categories ?? []);
        setProducts(payload.filters.products ?? []);
        setProductCount(payload.filters.productCount ?? 0);
        setTruncated(Boolean(payload.filters.truncated));
        setIndustryName(payload.industryName ?? null);
        setError("");
      } catch (reason) {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "No fue posible cargar los filtros inteligentes");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, category && search ? 300 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [supermarket, category, search]);

  const selected = useMemo(() => new Set(selectedProductIds), [selectedProductIds]);

  function selectCategory(value: string) {
    setSearch("");
    onSelectedProductIdsChange([]);
    onCategoryChange(value);
  }

  function toggleProduct(id: string) {
    const next = new Set(selectedProductIds);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_SELECTED_PRODUCTS) next.add(id);
    onSelectedProductIdsChange([...next]);
  }

  function selectVisible() {
    const next = new Set(selectedProductIds);
    for (const product of products) {
      if (next.size >= MAX_SELECTED_PRODUCTS) break;
      next.add(product.id);
    }
    onSelectedProductIdsChange([...next]);
  }

  return <section className={styles.root}>
    <div className={styles.heading}>
      <div>
        <span>FILTRO INTELIGENTE</span>
        <strong>Categoría y productos</strong>
        <small>La clasificación respeta la industria {industryName ? <b>{industryName}</b> : "configurada para la organización"}.</small>
      </div>
      <em>✦ IA activa</em>
    </div>

    <label className={styles.categoryField}>
      <span>Categoría</span>
      <select value={category} onChange={(event) => selectCategory(event.target.value)} disabled={loading && !categories.length}>
        <option value="">Todas las categorías inteligentes</option>
        {categories.map((item) => <option key={item.value} value={item.value}>
          {item.label} · {integer.format(item.products)} productos
        </option>)}
      </select>
    </label>

    {category && <div className={styles.productBlock}>
      <div className={styles.productTop}>
        <div>
          <span>Productos de {category}</span>
          <small>{integer.format(productCount)} SKU detectados por la clasificación inteligente</small>
        </div>
        <div className={styles.actions}>
          <button type="button" className={!selectedProductIds.length ? styles.active : ""} onClick={() => onSelectedProductIdsChange([])}>Todos</button>
          <button type="button" onClick={selectVisible} disabled={!products.length}>Seleccionar visibles</button>
        </div>
      </div>

      <div className={styles.searchRow}>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto, marca o SKU…" />
        <b>{selectedProductIds.length ? `${integer.format(selectedProductIds.length)} seleccionados` : "Todos incluidos"}</b>
      </div>

      {error ? <div className={styles.error}>{error}</div> : loading ? <div className={styles.loading}><i /> Clasificando productos…</div> : !products.length ? <div className={styles.empty}>No se encontraron productos para este filtro.</div> : <div className={styles.productList}>
        {products.map((product) => <label key={product.id} className={selected.has(product.id) ? styles.checked : ""}>
          <input type="checkbox" checked={selected.has(product.id)} onChange={() => toggleProduct(product.id)} />
          <span>
            <strong>{product.name}</strong>
            <small>{[product.brand, product.supermarket, `SKU ${product.externalId}`].filter(Boolean).join(" · ")}</small>
          </span>
        </label>)}
      </div>}

      <div className={styles.help}>
        {!selectedProductIds.length
          ? "Se exportarán automáticamente todos los productos de la categoría."
          : `Se exportarán solo los ${integer.format(selectedProductIds.length)} SKU seleccionados.`}
        {truncated && " La categoría es extensa; usa el buscador para localizar SKU adicionales."}
        {selectedProductIds.length >= MAX_SELECTED_PRODUCTS && ` El máximo de selección individual es ${integer.format(MAX_SELECTED_PRODUCTS)} SKU.`}
      </div>
    </div>}
  </section>;
}
