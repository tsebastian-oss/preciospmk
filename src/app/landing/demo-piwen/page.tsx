import { PageChrome } from "../MarketingShell";
import styles from "./piwen.module.css";

export const metadata = {
  title: "Demo Piwén | MGP Super Precios",
  description: "Demo comercial de pricing intelligence para Piwén con referencias públicas de ecommerce, marketplace, mayorista y benchmark competitivo.",
};

const benchmarkRows = [
  {
    product: "Almendra natural",
    piwenPack: "250 g",
    piwenPrice: "$5.450",
    piwenKg: "$21.800/kg",
    competitor: "Alto La Cruz · Jumbo",
    competitorPack: "700 g",
    competitorPrice: "$11.990",
    competitorKg: "$17.129/kg",
    gap: "+27,3%",
    tone: "premium",
  },
  {
    product: "Castaña de cajú sin sal",
    piwenPack: "80 g",
    piwenPrice: "$2.150",
    piwenKg: "$26.875/kg",
    competitor: "Millantú · Jumbo",
    competitorPack: "120 g",
    competitorPrice: "$3.650",
    competitorKg: "$30.417/kg",
    gap: "−11,6%",
    tone: "opportunity",
  },
  {
    product: "Pistacho sin sal",
    piwenPack: "80 g",
    piwenPrice: "$3.150",
    piwenKg: "$39.375/kg",
    competitor: "Millantú · Jumbo",
    competitorPack: "100 g",
    competitorPrice: "$3.550",
    competitorKg: "$35.500/kg",
    gap: "+10,9%",
    tone: "premium",
  },
];

const channelRows = [
  {
    sku: "Castañas de cajú sin sal 1 kg",
    channelA: "Piwén.cl",
    priceA: "$23.800",
    channelB: "Mercado Libre",
    priceB: "$16.480",
    signal: "−30,8%",
    message: "Marketplace bajo el precio directo",
  },
  {
    sku: "Almendra natural 250 g",
    channelA: "Piwén.cl",
    priceA: "$5.450",
    channelB: "Mercado Libre",
    priceB: "$5.340",
    signal: "−2,0%",
    message: "Paridad prácticamente controlada",
  },
  {
    sku: "Mix Aconcagua",
    channelA: "D2C 1 kg",
    priceA: "$11.800/kg",
    channelB: "Mayorista caja 5 kg",
    priceB: "$6.120/kg",
    signal: "−48,1%",
    message: "Escalera mayorista visible",
  },
];

const alerts = [
  {
    title: "Alerta de canal",
    badge: "Alta prioridad",
    body: "Castañas de cajú 1 kg aparece cerca de 31% más barata en marketplace que en Piwén.cl. Super Precios puede vigilar esta brecha todos los días.",
  },
  {
    title: "Posicionamiento competitivo",
    badge: "Pricing",
    body: "En castañas de cajú, Piwén está bajo un comparable directo de Jumbo en $/kg; en pistacho y almendra muestra una posición premium.",
  },
  {
    title: "Arquitectura de packs",
    badge: "Margen",
    body: "El sistema puede seguir la escalera 80 g / 250 g / 1 kg / mayorista y detectar incoherencias de precio por kilo antes de que afecten margen o percepción.",
  },
];

export default function PiwenDemoPage() {
  return (
    <PageChrome active="inicio">
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroTop}>
            <div>
              <span className={styles.eyebrow}>DEMO COMERCIAL · 28 AGO 2026</span>
              <h1>Pricing Intelligence para <span>Piwén</span></h1>
              <p>
                Una vista ejecutiva para controlar precios por canal, normalizar por kilo,
                detectar promociones y entender si cada SKU está barato, alineado o premium
                frente al mercado.
              </p>
            </div>
            <div className={styles.brandCard} aria-label="Piwén demo">
              <div className={styles.brandMark}>p</div>
              <div>
                <strong>Piwén</strong>
                <small>frutos secos · demo</small>
              </div>
            </div>
          </div>

          <div className={styles.kpis}>
            <article>
              <span>Catálogo visible</span>
              <strong>71</strong>
              <small>productos en piwen.cl</small>
            </article>
            <article>
              <span>Canales observables</span>
              <strong>3+</strong>
              <small>D2C · marketplace · mayorista</small>
            </article>
            <article className={styles.warningCard}>
              <span>Mayor brecha detectada</span>
              <strong>−30,8%</strong>
              <small>marketplace vs precio directo</small>
            </article>
            <article>
              <span>Benchmark</span>
              <strong>$/kg</strong>
              <small>comparación manzanas con manzanas</small>
            </article>
          </div>
        </section>

        <section className={styles.grid2}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span>01 · PARIDAD DE CANALES</span>
                <h2>¿Dónde se está vendiendo más barato Piwén?</h2>
              </div>
              <div className={styles.liveDot}><i /> referencia pública</div>
            </div>

            <div className={styles.channelList}>
              {channelRows.map((row) => (
                <div className={styles.channelRow} key={row.sku}>
                  <div className={styles.channelSku}>
                    <strong>{row.sku}</strong>
                    <small>{row.message}</small>
                  </div>
                  <div className={styles.channelPrice}>
                    <span>{row.channelA}</span>
                    <b>{row.priceA}</b>
                  </div>
                  <div className={styles.arrow}>→</div>
                  <div className={styles.channelPrice}>
                    <span>{row.channelB}</span>
                    <b>{row.priceB}</b>
                  </div>
                  <div className={styles.signal}>{row.signal}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span>02 · ALERTAS EJECUTIVAS</span>
                <h2>Lo que el gerente debería ver al entrar</h2>
              </div>
            </div>
            <div className={styles.alerts}>
              {alerts.map((alert, index) => (
                <article key={alert.title}>
                  <div className={styles.alertIndex}>0{index + 1}</div>
                  <div>
                    <div className={styles.alertTitle}>
                      <strong>{alert.title}</strong>
                      <span>{alert.badge}</span>
                    </div>
                    <p>{alert.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <span>03 · BENCHMARK NORMALIZADO</span>
              <h2>Comparación competitiva por precio por kilo</h2>
              <p>El gramaje deja de distorsionar la lectura. Super Precios convierte cada producto a una unidad comparable.</p>
            </div>
            <div className={styles.chip}>Benchmark retail</div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Piwén</th>
                  <th>$/kg Piwén</th>
                  <th>Comparable</th>
                  <th>$/kg comparable</th>
                  <th>Índice</th>
                </tr>
              </thead>
              <tbody>
                {benchmarkRows.map((row) => (
                  <tr key={row.product}>
                    <td>
                      <strong>{row.product}</strong>
                      <small>{row.piwenPack} · {row.piwenPrice}</small>
                    </td>
                    <td><span className={styles.piwenTag}>Piwén</span></td>
                    <td><strong>{row.piwenKg}</strong></td>
                    <td>
                      <strong>{row.competitor}</strong>
                      <small>{row.competitorPack} · {row.competitorPrice}</small>
                    </td>
                    <td>{row.competitorKg}</td>
                    <td>
                      <span className={row.tone === "opportunity" ? styles.goodGap : styles.premiumGap}>
                        {row.gap}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.aiSection}>
          <div className={styles.aiIntro}>
            <span>04 · ASISTENTE DE PRICING</span>
            <h2>Preguntas que el equipo podría hacerle al sistema</h2>
            <p>La capa de IA toma los datos monitoreados y los transforma en respuestas accionables para pricing, comercial y gerencia.</p>
          </div>
          <div className={styles.prompts}>
            <div><span>↗</span>¿Qué SKUs de Piwén están más baratos fuera de piwen.cl?</div>
            <div><span>↗</span>¿En qué categorías estamos cobrando un premium sobre el mercado?</div>
            <div><span>↗</span>¿Qué precio sugerirías para castañas de cajú manteniendo un índice 100 vs competencia?</div>
            <div><span>↗</span>¿Qué promociones de competidores aparecieron esta semana?</div>
          </div>
        </section>

        <section className={styles.valueSection}>
          <div>
            <span>LO QUE PIWÉN PODRÍA AUTOMATIZAR</span>
            <h2>De revisar precios manualmente a administrar una arquitectura de pricing.</h2>
          </div>
          <div className={styles.valueGrid}>
            <article><b>01</b><strong>Monitoreo diario</strong><p>Piwén.cl, marketplaces y retailers relevantes.</p></article>
            <article><b>02</b><strong>Precio por unidad</strong><p>$/kg, $/100 g o la métrica que permita comparar packs.</p></article>
            <article><b>03</b><strong>Guardrails</strong><p>Alertas cuando un canal rompe paridad o una promo excede el rango definido.</p></article>
            <article><b>04</b><strong>Decisión comercial</strong><p>Insights para subir, bajar o mantener precio con evidencia competitiva.</p></article>
          </div>
        </section>

        <footer className={styles.sources}>
          <strong>Fuentes públicas utilizadas en esta demo</strong>
          <p>
            Piwén.cl, Piwén Mayorista, tienda oficial Piwén en Mercado Libre y referencias de Jumbo.cl.
            Cifras observadas el 28 de agosto de 2026; pueden cambiar por promociones, stock o canal.
            Esta página es una demo comercial y no reemplaza el monitoreo automatizado de la plataforma.
          </p>
          <div>
            <a href="https://www.piwen.cl/collections/all" target="_blank" rel="noreferrer">Catálogo Piwén ↗</a>
            <a href="https://mayorista.piwen.cl/" target="_blank" rel="noreferrer">Piwén Mayorista ↗</a>
            <a href="https://www.mercadolibre.cl/tienda/piwen" target="_blank" rel="noreferrer">Mercado Libre ↗</a>
            <a href="https://www.jumbo.cl/chocolates-galletas-y-snacks/snacks/mani-y-frutos-secos" target="_blank" rel="noreferrer">Benchmark Jumbo ↗</a>
          </div>
        </footer>
      </main>
    </PageChrome>
  );
}
