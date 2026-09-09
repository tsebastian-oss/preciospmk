'use client';

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type PriceResult = {
  id: string;
  retailer: string;
  brand: string;
  name: string;
  currentPrice: number;
  regularPrice: number | null;
  offerPrice: number | null;
  discountPct: number | null;
  inStock: boolean;
  observedAt: string | null;
  url: string | null;
};

type SearchPayload = {
  query: string;
  results: PriceResult[];
  summary: null | {
    bestPrice: number;
    bestRetailer: string;
    medianPrice: number | null;
    maxPrice: number | null;
    savingsVsMedian: number | null;
    savingsVsMax: number | null;
    stores: number;
    matches: number;
  };
  message: string | null;
};

type SavedItem = PriceResult & { savedAt: string };

const SUGGESTIONS = ["leche", "coca cola", "aceite", "detergente", "arroz"];
const LIST_STORAGE_KEY = "super-precios-consumer-list-v1";

function money(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(value);
}

function observedLabel(value: string | null) {
  if (!value) return "Precio reciente";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Precio reciente";
  return `Actualizado ${date.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })}`;
}

export default function ConsumerSavingsPage() {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [payload, setPayload] = useState<SearchPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [tab, setTab] = useState<"home" | "search" | "list">("home");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LIST_STORAGE_KEY);
      if (raw) setSaved(JSON.parse(raw) as SavedItem[]);
    } catch {
      // Local storage is optional; the comparison experience still works without it.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(LIST_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Ignore storage quota/private-mode failures.
    }
  }, [saved]);

  async function search(nextQuery: string) {
    const clean = nextQuery.replace(/\s+/g, " ").trim();
    if (clean.length < 2) return;
    setQuery(clean);
    setActiveQuery(clean);
    setTab("search");
    setLoading(true);
    try {
      const response = await fetch(`/api/consumer-price-search?q=${encodeURIComponent(clean)}`);
      const data = (await response.json()) as SearchPayload;
      setPayload(data);
    } catch {
      setPayload({
        query: clean,
        results: [],
        summary: null,
        message: "No pudimos consultar precios en este momento.",
      });
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void search(query);
  }

  function toggleSaved(item: PriceResult) {
    setSaved((current) => {
      const exists = current.some((savedItem) => savedItem.id === item.id);
      if (exists) return current.filter((savedItem) => savedItem.id !== item.id);
      return [{ ...item, savedAt: new Date().toISOString() }, ...current].slice(0, 40);
    });
  }

  const savedIds = useMemo(() => new Set(saved.map((item) => item.id)), [saved]);
  const savedTotal = useMemo(
    () => saved.reduce((sum, item) => sum + item.currentPrice, 0),
    [saved],
  );

  return (
    <main className={styles.shell}>
      <div className={styles.phone}>
        <header className={styles.topbar}>
          <div className={styles.brandLockup}>
            <div className={styles.logoMark}>S</div>
            <div>
              <strong>Super Precios</strong>
              <span>Compara · Ahorra · Compra mejor</span>
            </div>
          </div>
          <button className={styles.profileButton} type="button" aria-label="Perfil">
            SP
          </button>
        </header>

        <section className={styles.content}>
          {tab === "home" ? (
            <>
              <section className={styles.hero}>
                <span className={styles.eyebrow}>Tu compra, al mejor precio</span>
                <h1>Antes de comprar,<br />compáralo.</h1>
                <p>Busca un producto y revisa los precios recientes que encontramos en supermercados.</p>
              </section>

              <SearchBox query={query} setQuery={setQuery} submit={submit} />

              <div className={styles.suggestions}>
                {SUGGESTIONS.map((item) => (
                  <button key={item} type="button" onClick={() => void search(item)}>
                    {item}
                  </button>
                ))}
              </div>

              <section className={styles.valueCard}>
                <div className={styles.valueIcon}>$</div>
                <div>
                  <span>La idea es simple</span>
                  <strong>No vuelvas a pagar de más.</strong>
                  <p>Comparamos los precios disponibles y te mostramos primero la opción más conveniente.</p>
                </div>
              </section>

              <section className={styles.featureGrid}>
                <article>
                  <span>01</span>
                  <strong>Compara</strong>
                  <p>Precios recientes de distintos supermercados.</p>
                </article>
                <article>
                  <span>02</span>
                  <strong>Guarda</strong>
                  <p>Arma tu lista mientras encuentras mejores precios.</p>
                </article>
                <article>
                  <span>03</span>
                  <strong>Próximamente</strong>
                  <p>Alertas, boletas e IA para optimizar toda tu compra.</p>
                </article>
              </section>
            </>
          ) : null}

          {tab === "search" ? (
            <>
              <div className={styles.searchSticky}>
                <SearchBox query={query} setQuery={setQuery} submit={submit} compact />
              </div>

              {loading ? <SearchSkeleton /> : null}

              {!loading && payload?.summary ? (
                <section className={styles.summaryCard}>
                  <div>
                    <span>Mejor precio encontrado</span>
                    <strong>{money(payload.summary.bestPrice)}</strong>
                    <p>en {payload.summary.bestRetailer}</p>
                  </div>
                  <div className={styles.savingBubble}>
                    <span>Puedes ahorrar hasta</span>
                    <strong>{money(payload.summary.savingsVsMax)}</strong>
                  </div>
                  <div className={styles.summaryMeta}>
                    <span>{payload.summary.stores} tiendas</span>
                    <span>{payload.summary.matches} coincidencias</span>
                  </div>
                </section>
              ) : null}

              {!loading && payload?.message ? (
                <section className={styles.emptyState}>
                  <strong>{payload.message}</strong>
                  <p>Prueba con la marca, categoría o una descripción más corta.</p>
                </section>
              ) : null}

              {!loading && payload?.results?.length ? (
                <section className={styles.resultsSection}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <span>Resultados para</span>
                      <h2>“{activeQuery}”</h2>
                    </div>
                    <small>Ordenados por precio</small>
                  </div>

                  <div className={styles.resultsList}>
                    {payload.results.map((item, index) => {
                      const savedItem = savedIds.has(item.id);
                      return (
                        <article className={styles.priceCard} key={`${item.id}-${item.retailer}`}>
                          <div className={styles.cardTopline}>
                            <span className={index === 0 && item.inStock ? styles.bestBadge : styles.storeBadge}>
                              {index === 0 && item.inStock ? "Mejor precio" : item.retailer}
                            </span>
                            {item.discountPct ? <span className={styles.discount}>-{item.discountPct}%</span> : null}
                          </div>

                          <div className={styles.productInfo}>
                            <span>{item.brand || "Producto"}</span>
                            <h3>{item.name}</h3>
                            <p>{item.retailer} · {observedLabel(item.observedAt)}</p>
                          </div>

                          <div className={styles.priceRow}>
                            <div>
                              <strong>{money(item.currentPrice)}</strong>
                              {item.regularPrice && item.currentPrice < item.regularPrice ? (
                                <del>{money(item.regularPrice)}</del>
                              ) : null}
                            </div>
                            <span className={item.inStock ? styles.stock : styles.noStock}>
                              {item.inStock ? "Disponible" : "Sin stock"}
                            </span>
                          </div>

                          <div className={styles.cardActions}>
                            <button
                              type="button"
                              className={savedItem ? styles.savedButton : styles.saveButton}
                              onClick={() => toggleSaved(item)}
                            >
                              {savedItem ? "✓ Guardado" : "+ Mi lista"}
                            </button>
                            {item.url ? (
                              <a href={item.url} target="_blank" rel="noreferrer">
                                Ver tienda
                              </a>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          {tab === "list" ? (
            <section className={styles.listView}>
              <span className={styles.eyebrow}>Mi compra</span>
              <h1>Tu lista</h1>
              <p>Guarda alternativas mientras comparas. En la siguiente fase optimizaremos la canasta completa por supermercado.</p>

              {saved.length ? (
                <>
                  <div className={styles.listTotal}>
                    <span>{saved.length} productos guardados</span>
                    <strong>{money(savedTotal)}</strong>
                    <small>Total de las alternativas seleccionadas</small>
                  </div>
                  <div className={styles.savedList}>
                    {saved.map((item) => (
                      <article key={item.id}>
                        <div>
                          <span>{item.retailer}</span>
                          <strong>{item.name}</strong>
                          <small>{item.brand || "Producto"}</small>
                        </div>
                        <div>
                          <strong>{money(item.currentPrice)}</strong>
                          <button type="button" onClick={() => toggleSaved(item)}>Quitar</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className={styles.emptyState}>
                  <strong>Tu lista está vacía.</strong>
                  <p>Busca un producto y toca “+ Mi lista”.</p>
                  <button type="button" onClick={() => setTab("search")}>Buscar precios</button>
                </div>
              )}
            </section>
          ) : null}
        </section>

        <nav className={styles.bottomNav} aria-label="Navegación principal">
          <button className={tab === "home" ? styles.activeNav : ""} type="button" onClick={() => setTab("home")}>
            <span>⌂</span>Inicio
          </button>
          <button className={tab === "search" ? styles.activeNav : ""} type="button" onClick={() => setTab("search")}>
            <span>⌕</span>Buscar
          </button>
          <button className={tab === "list" ? styles.activeNav : ""} type="button" onClick={() => setTab("list")}>
            <span>≡</span>Lista{saved.length ? <b>{saved.length}</b> : null}
          </button>
          <button type="button" disabled title="Próximamente">
            <span>♢</span>Alertas
          </button>
        </nav>
      </div>
    </main>
  );
}

function SearchBox({
  query,
  setQuery,
  submit,
  compact = false,
}: {
  query: string;
  setQuery: (value: string) => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
  compact?: boolean;
}) {
  return (
    <form className={`${styles.searchBox} ${compact ? styles.searchBoxCompact : ""}`} onSubmit={submit}>
      <span className={styles.searchIcon}>⌕</span>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="¿Qué quieres comprar?"
        aria-label="Buscar producto"
      />
      <button type="submit" disabled={query.trim().length < 2}>Comparar</button>
    </form>
  );
}

function SearchSkeleton() {
  return (
    <section className={styles.skeletonWrap} aria-label="Buscando precios">
      <div className={styles.skeletonHero} />
      <div className={styles.skeletonCard} />
      <div className={styles.skeletonCard} />
      <p>Comparando precios recientes…</p>
    </section>
  );
}
