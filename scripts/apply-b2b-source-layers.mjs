import fs from "node:fs";

const path = "src/app/B2BPricing.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`B2B source layers: missing ${label}`);
  source = source.replace(from, to);
}

replaceOnce(
  'type MatrixMetric = "shipment" | "kg" | "km" | "kgkm" | "index";',
  'type PricingLayer = "public" | "b2b" | "best";\ntype MatrixMetric = "shipment" | "kg" | "km" | "kgkm" | "index";',
  "PricingLayer type",
);
replaceOnce(
  '  marketMedianPricePerKm: Numeric;\n  providersInProfile: Numeric;',
  '  marketMedianPricePerKm: Numeric;\n  marketMedianPricePerKgKm?: Numeric;\n  sourceKinds?: string[];\n  sourceLayers?: string[];\n  providersInProfile: Numeric;',
  "comparable source fields",
);
replaceOnce(
  '  normalized?: NormalizedPayload;\n  source: string;',
  '  normalized?: NormalizedPayload;\n  layer?: PricingLayer;\n  annexes?: { detected?: Numeric; parsed?: Numeric; scanned?: Numeric; noPrice?: Numeric; errors?: Numeric; candidateRates?: Numeric; latestDate?: string | null };\n  source: string;',
  "payload layer fields",
);
replaceOnce(
  'const PROVIDER_PRIORITY = ["Chilexpress", "Blue Express", "Starken", "CorreosChile"];',
  'const PROVIDER_PRIORITY = ["Chilexpress", "Blue Express", "Starken", "CorreosChile"];\nconst PRICING_LAYERS: Array<{ key: PricingLayer; label: string; description: string }> = [\n  { key: "public", label: "Tarifa pública", description: "Tarifarios comerciales publicados por los couriers." },\n  { key: "b2b", label: "B2B observado", description: "Tarifas unitarias verificadas en ofertas, anexos y órdenes públicas." },\n  { key: "best", label: "Mejor precio observado", description: "Menor tarifa verificable por courier y perfil entre las capas disponibles." },\n];',
  "pricing layer constants",
);
replaceOnce(
  'const WEIGHT_BANDS = ["0–0,5 kg", "0,5–1,5 kg", "1,5–3 kg", "3–6 kg", "6–10 kg", "10–15 kg", "15–20 kg", "20+ kg"];',
  'const WEIGHT_BANDS = ["0–0,5 kg", "0,5–1,5 kg", "0–1,4 kg", "1,5–2,9 kg", "1,5–3 kg", "3–5,9 kg", "3–6 kg", "6–10 kg", "10–15 kg", "15–20 kg", "20+ kg"];',
  "observed B2B weight bands",
);
replaceOnce(
  '  if (metric === "kgkm") {\n    const kg = n(row.marketMedianPricePerKg);\n    const km = n(row.medianPricePerKm);\n    const providerKg = n(row.medianPricePerKg);\n    return providerKg > 0 && km > 0 ? kg * (km / providerKg) : 0;\n  }',
  '  if (metric === "kgkm") return n(row.marketMedianPricePerKgKm);',
  "market kgkm metric",
);
replaceOnce(
  '  const [distanceBand, setDistanceBand] = useState("all");\n  const [matrixMetric, setMatrixMetric] = useState<MatrixMetric>("shipment");',
  '  const [distanceBand, setDistanceBand] = useState("all");\n  const [pricingLayer, setPricingLayer] = useState<PricingLayer>("public");\n  const [matrixMetric, setMatrixMetric] = useState<MatrixMetric>("shipment");',
  "pricing layer state",
);
replaceOnce(
  '      const response = await fetch(`/api/b2b-pricing?category=courier&days=${days}&live=${Date.now()}`, { cache: "no-store" });',
  '      const response = await fetch(`/api/b2b-pricing?category=courier&days=${days}&layer=${pricingLayer}&live=${Date.now()}`, { cache: "no-store" });',
  "layer query parameter",
);
replaceOnce('  }, [days]);', '  }, [days, pricingLayer]);', "load dependencies");

if (!source.includes('fetch("/api/b2b-pricing/market-public-rates/refresh"')) {
  const refreshStart = source.indexOf('      const marketResponse = await fetch("/api/b2b-pricing/refresh"');
  const refreshEnd = refreshStart >= 0 ? source.indexOf('      await load();', refreshStart) : -1;
  if (refreshStart < 0 || refreshEnd < 0) throw new Error("B2B source layers: missing refresh anchors");
  const newRefresh = `      const requestInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ months: 2, maxPages: 4 }) } as const;
      const [marketResponse, publicResponse, annexResponse] = await Promise.all([
        fetch("/api/b2b-pricing/refresh", requestInit),
        fetch("/api/b2b-pricing/public-rates/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
        fetch("/api/b2b-pricing/market-public-rates/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      ]);
      const market = await marketResponse.json() as { matched?: number; error?: string };
      const publicRates = await publicResponse.json() as { ingested?: number; rows?: number; error?: string };
      const annexes = await annexResponse.json() as { acceptedComparableRates?: number; candidateRates?: number; pdfsRead?: number; error?: string };
      if (!marketResponse.ok) throw new Error(market.error || "No fue posible actualizar Mercado Público");
      if (!publicResponse.ok) throw new Error(publicRates.error || "No fue posible actualizar tarifarios públicos");
      if (!annexResponse.ok) throw new Error(annexes.error || "No fue posible revisar anexos públicos");
      setNotice(\`Fuentes actualizadas: \${nf.format(Number(publicRates.rows || publicRates.ingested || 0))} tarifas públicas · \${nf.format(Number(annexes.acceptedComparableRates || 0))} tarifas B2B verificadas · \${nf.format(Number(annexes.candidateRates || 0))} candidatos revisados en \${nf.format(Number(annexes.pdfsRead || 0))} anexos.\`);
`;
  source = source.slice(0, refreshStart) + newRefresh + source.slice(refreshEnd);
}

const matrixControlAnchor = `        <div className={matrixStyles.matrixControls}>
          <div>
            <span className={matrixStyles.controlLabel}>Métrica de comparación</span>`;
const matrixControlReplacement = `        <div className={matrixStyles.matrixControls}>
          <div>
            <span className={matrixStyles.controlLabel}>Fuente de precio</span>
            <div className={matrixStyles.metricTabs}>
              {PRICING_LAYERS.map((layer) => <button key={layer.key} type="button" className={pricingLayer === layer.key ? matrixStyles.activeMetric : ""} onClick={() => setPricingLayer(layer.key)} title={layer.description}>{layer.label}</button>)}
            </div>
            <small style={{ display: "block", marginTop: 7, color: "#6f7e90", maxWidth: 720 }}>{PRICING_LAYERS.find((layer) => layer.key === pricingLayer)?.description}</small>
          </div>
          <div>
            <span className={matrixStyles.controlLabel}>Métrica de comparación</span>`;
replaceOnce(matrixControlAnchor, matrixControlReplacement, "source layer tabs");
replaceOnce(
  '<div className={styles.methodStrip}><b>Lectura:</b> cada fila es una comparación manzana-con-manzana. El color indica posición contra la mediana del mismo perfil. “Menor tarifa” identifica el precio más bajo observado en esa fila; no implica por sí solo mejor nivel de servicio.</div>',
  '<div className={styles.methodStrip}><b>Lectura:</b> cada fila es una comparación manzana-con-manzana. La capa activa es <b>{PRICING_LAYERS.find((layer) => layer.key === pricingLayer)?.label}</b>. El color indica posición contra la mediana del mismo perfil. “Menor tarifa” identifica el precio más bajo observado en esa fila; no implica por sí solo mejor nivel de servicio.</div>',
  "layer methodology copy",
);
replaceOnce(
  '<b>No hay perfiles para estos filtros.</b><br/>Prueba dejando proveedor, peso o distancia en “Todos”.',
  '<b>{pricingLayer === "b2b" ? "Aún no hay tarifas B2B verificadas para estos filtros." : "No hay perfiles para estos filtros."}</b><br/>{pricingLayer === "b2b" ? "Usa “Actualizar fuentes” para revisar anexos económicos públicos; solo aparecerán precios unitarios que pasen la validación de comparabilidad." : "Prueba dejando proveedor, peso o distancia en “Todos”."}',
  "B2B empty state",
);
replaceOnce(
  '<div className={styles.footnote}>Fuente: Mercado Público / ChileCompra y tarifarios públicos normalizados. La matriz separa tarifas comparables de contratos agregados y no representa contratos privados no publicados. Última ingestión: {date(data.summary.lastIngestedAt)}.</div>',
  '<div className={styles.footnote}>Fuente: Mercado Público / ChileCompra y tarifarios públicos normalizados. “B2B observado” incorpora únicamente tarifas unitarias extraídas de evidencia pública verificable; anexos ambiguos o escaneados no generan precios. Anexos detectados: {nf.format(n(data.annexes?.detected))} · candidatos tarifarios: {nf.format(n(data.annexes?.candidateRates))}. Última ingestión: {date(data.summary.lastIngestedAt)}.</div>',
  "annex provenance footer",
);

fs.writeFileSync(path, source);
console.log("B2B public/B2B/best pricing source layers applied");
