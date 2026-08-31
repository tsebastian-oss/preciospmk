"use client";

import { useMemo, useState } from "react";
import styles from "./PiwenMarketPanel.module.css";
import { trackUsageEvent } from "@/lib/usage-client";

export type MatrixListing = {
  id: string;
  retailer: string;
  brand: string;
  family: string;
  currentPrice: number | null;
  pricePerKg: number | null;
  inStock: boolean | null;
};

const FAMILY_ORDER = [
  "Almendras",
  "Castañas de cajú",
  "Pistachos",
  "Nueces",
  "Maní",
  "Mixes",
  "Avellanas",
  "Semillas",
  "Fruta deshidratada",
];

const PRIORITY_BRANDS = ["Piwén", "Alto La Cruz", "Millantú"];

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export default function PiwenPriceMatrix({ rows }: { rows: MatrixListing[] }) {
  const [retailer, setRetailer] = useState("");

  const retailerOptions = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach(row => {
      if (!row.retailer || !row.currentPrice || row.currentPrice <= 0) return;
      counts.set(row.retailer, (counts.get(row.retailer) ?? 0) + 1);
    });
    return [...counts.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],"es")).map(([name])=>name);
  }, [rows]);

  const filtered = useMemo(
    () => rows.filter(row => (!retailer || row.retailer === retailer) && row.currentPrice != null && row.currentPrice > 0 && row.inStock !== false),
    [rows, retailer],
  );

  const families = useMemo(() => {
    const counts = new Map<string, number>();
    filtered.forEach(row => counts.set(row.family, (counts.get(row.family) ?? 0) + 1));
    return [...counts.keys()]
      .sort((a,b) => {
        const ai = FAMILY_ORDER.indexOf(a);
        const bi = FAMILY_ORDER.indexOf(b);
        if (ai >= 0 && bi >= 0) return ai-bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      })
      .slice(0, 8);
  }, [filtered]);

  const brands = useMemo(() => {
    const globalCounts = new Map<string, number>();
    rows.forEach(row => {
      if (!row.brand || !row.currentPrice || row.currentPrice <= 0) return;
      globalCounts.set(row.brand, (globalCounts.get(row.brand) ?? 0) + 1);
    });
    const top = [...globalCounts.entries()].sort((a,b)=>b[1]-a[1]).map(([brand])=>brand).slice(0, 12);
    return [...new Set([...PRIORITY_BRANDS.filter(brand => globalCounts.has(brand)), ...top])].slice(0, 14);
  }, [rows]);

  const matrix = useMemo(() => {
    const map = new Map<string, { avgPrice: number|null; avgKg: number|null; sku: number }>();
    for (const brand of brands) {
      for (const family of families) {
        const cell = filtered.filter(row => row.brand === brand && row.family === family);
        map.set(`${brand}::${family}`, {
          avgPrice: average(cell.map(row => row.currentPrice).filter((value): value is number => value != null && value > 0)),
          avgKg: average(cell.map(row => row.pricePerKg).filter((value): value is number => value != null && value > 0)),
          sku: cell.length,
        });
      }
    }
    return map;
  }, [brands, families, filtered]);

  return <section className={styles.matrixPanel}>
    <div className={styles.matrixHeader}>
      <div>
        <span>MATRIZ COMPETITIVA</span>
        <h2>Precio promedio por producto y marca</h2>
        <p>Eje X = principales productos · Eje Y = principales marcas. El valor principal es el precio promedio de la tienda seleccionada; debajo se muestra el $/kg promedio cuando existe gramaje.</p>
      </div>
      <label className={styles.matrixRetailer}>
        <span>TIENDA / RETAILER</span>
        <select value={retailer} onChange={event => {
          setRetailer(event.target.value);
          trackUsageEvent("filter_change", { module: "piwen-market", metadata: { filter: "matrix-retailer", value: event.target.value || "all" } });
        }}>
          <option value="">Todas las tiendas · promedio</option>
          {retailerOptions.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
    </div>

    {!families.length || !brands.length ? <div className={styles.empty}>No hay datos suficientes para construir la matriz con esta tienda.</div> :
      <div className={styles.matrixWrap}>
        <table className={styles.matrixTable}>
          <thead>
            <tr><th className={styles.matrixCorner}>Marca ↓ / Producto →</th>{families.map(family => <th key={family}>{family}</th>)}</tr>
          </thead>
          <tbody>
            {brands.map(brand => <tr key={brand}>
              <th>{brand}</th>
              {families.map(family => {
                const cell = matrix.get(`${brand}::${family}`);
                return <td key={family} className={cell?.avgPrice ? styles.matrixValue : styles.matrixEmpty}>
                  {cell?.avgPrice ? <>
                    <strong>{money.format(Math.round(cell.avgPrice))}</strong>
                    <small>{cell.avgKg ? `${money.format(Math.round(cell.avgKg))}/kg` : "sin $/kg"} · {cell.sku} SKU</small>
                  </> : <span>—</span>}
                </td>;
              })}
            </tr>)}
          </tbody>
        </table>
      </div>}

    <div className={styles.matrixFoot}>
      <strong>{retailer || "Todas las tiendas"}</strong>
      <span>{filtered.length} observaciones con precio · promedio simple sobre los SKU vigentes de cada cruce marca/producto.</span>
    </div>
  </section>;
}
