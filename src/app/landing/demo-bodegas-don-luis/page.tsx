import { PageChrome } from "../MarketingShell";
import styles from "../demo-piwen/piwen.module.css";

export const metadata = {
  title: "Demo Bodegas Don Luis | MGP Super Precios",
  description: "Demo comercial de pricing intelligence para Bodegas Don Luis en Perú: Pisco, Ron y Vino en supermercados.",
};

const parityRows = [
  {
    sku: "Cuatro Gallos Quebranta 700 ml",
    channelA: "Tottus",
    priceA: "S/ 38,50",
    channelB: "Plaza Vea / Makro",
    priceB: "S/ 40,90",
    signal: "+6,2%",
    message: "Mismo SKU · dispersión entre retailers",
  },
  {
    sku: "Cuatro Gallos Italia 700 ml",
    channelA: "Vivanda",
    priceA: "S/ 34,30",
    channelB: "Plaza Vea / Makro",
    priceB: "S/ 40,90",
    signal: "+19,2%",
    message: "Brecha relevante en exactamente el mismo formato",
  },
  {
    sku: "E. Copello Moscato 750 ml",
    channelA: "Tottus",
    priceA: "S/ 13,90",
    channelB: "Metro",
    priceB: "S/ 15,90",
    signal: "+14,4%",
    message: "La promoción cambia la posición de precio",
  },
  {
    sku: "Mandatario Solera · eq. 700 ml",
    channelA: "Tottus",
    priceA: "S/ 64,31",
    channelB: "Vivanda",
    priceB: "S/ 74,90",
    signal: "+16,5%",
    message: "Normalizado por volumen para comparar formatos",
  },
];

const benchmarkRows = [
  {
    product: "Pisco mainstream",
    piwenPack: "Cuatro Gallos Quebranta 700 ml",
    piwenPrice: "S/ 38,50",
    piwenKg: "S/ 55,00/L",
    competitor: "Santiago Queirolo · Tottus",
    competitorPack: "Quebranta 750 ml",
    competitorPrice: "S/ 26,50",
    competitorKg: "S/ 35,33/L",
    gap: "+55,7%",
    tone: "premium",
  },
  {
    product: "Pisco premium",
    piwenPack: "Cuatro Gallos Quebranta 700 ml",
    piwenPrice: "S/ 38,50",
    piwenKg: "S/ 55,00/L",
    competitor: "Finca Rotondo · Tottus",
    competitorPack: "Mosto Verde 750 ml",
    competitorPrice: "S/ 56,90",
    competitorKg: "S/ 75,87/L",
    gap: "−27,5%",
    tone: "opportunity",
  },
  {
    product: "Vino entrada",
    piwenPack: "E. Copello Tinto 750 ml",
    piwenPrice: "S/ 13,90",
    piwenKg: "S/ 18,53/L",
    competitor: "Santiago Queirolo · Tottus",
    competitorPack: "Magdalena 750 ml",
    competitorPrice: "S/ 14,90",
    competitorKg: "S/ 19,87/L",
    gap: "−6,7%",
    tone: "opportunity",
  },
  {
    product: "Ron premium",
    piwenPack: "Mandatario Solera 750 ml",
    piwenPrice: "S/ 68,90",
    piwenKg: "S/ 91,87/L",
    competitor: "Flor de Caña 12 · Tottus",
    competitorPack: "750 ml",
    competitorPrice: "S/ 99,90",
    competitorKg: "S/ 133,20/L",
    gap: "−31,0%",
    tone: "opportunity",
  },
];

const alerts = [
  {
    title: "Paridad de precios",
    badge: "Alta prioridad",
    body: "Cuatro Gallos Italia 700 ml presenta una dispersión cercana a 19% entre Vivanda y Plaza Vea/Makro. La marca puede detectar cuándo una promoción cambia demasiado la arquitectura de precio.",
  },
  {
    title: "Posicionamiento de Pisco",
    badge: "Pricing",
    body: "Cuatro Gallos queda claramente por encima de una referencia mainstream como Santiago Queirolo, pero por debajo de una referencia premium como Finca Rotondo Mosto Verde. Esa franja se puede monitorear diariamente.",
  },
  {
    title: "Distribución del portafolio",
    badge: "Digital shelf",
    body: "Cuatro Gallos tiene amplia visibilidad en las cadenas observadas; E. Copello, Casas Patronales, Lagarde y Mandatario muestran coberturas distintas. La demo permite convertir esas ausencias en oportunidades comerciales.",
  },
];

const coverage = [
  ["Cuatro Gallos", "●", "●", "●", "●", "●"],
  ["Mandatario", "●", "●", "●", "●", "—"],
  ["E. Copello", "●", "●", "—", "—", "—"],
  ["Casas Patronales", "●", "●", "●", "—", "—"],
  ["Lagarde", "●", "●", "—", "—", "—"],
];

export default function BodegasDonLuisDemoPage() {
  return (
    <PageChrome active="inicio">
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroTop}>
            <div>
              <span className={styles.eyebrow}>DEMO COMERCIAL · PERÚ · 28 AGO 2026</span>
              <h1>Pricing Intelligence para <span>Bodegas Don Luis</span></h1>
              <p>
                Una vista ejecutiva para seguir Pisco, Ron y Vino en los principales supermercados
                peruanos, controlar paridad por retailer y entender dónde cada marca del portafolio
                está barata, alineada o premium frente a su competencia.
              </p>
            </div>
            <div className={styles.brandCard}>
              <div className={styles.brandMark}>DL</div>
              <div>
                <strong>Bodegas Don Luis</strong>
                <small>Perú · demo comercial</small>
              </div>
            </div>
          </div>

          <div className={styles.kpis}>
            <article>
              <span>Retailers observados</span>
              <strong>5</strong>
              <small>Tottus · Metro · Wong · Vivanda · Plaza Vea/Makro</small>
            </article>
            <article>
              <span>Categorías</span>
              <strong>3</strong>
              <small>Pisco · Ron · Vino</small>
            </article>
            <article className={styles.warningCard}>
              <span>Mayor dispersión detectada</span>
              <strong>19,2%</strong>
              <small>Cuatro Gallos Italia 700 ml</small>
            </article>
            <article>
              <span>Normalización</span>
              <strong>S/ / L</strong>
              <small>precio comparable por litro</small>
            </article>
          </div>
        </section>

        <section className={styles.grid2}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <span>01 · PARIDAD POR RETAILER</span>
                <h2>¿Dónde aparece más barato el mismo SKU?</h2>
              </div>
              <div className={styles.liveDot}><i /> referencias públicas</div>
            </div>

            <div className={styles.channelList}>
              {parityRows.map((row) => (
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
                <h2>Lo que debería ver el equipo comercial</h2>
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
              <h2>Posicionamiento competitivo por precio por litro</h2>
              <p>La plataforma normaliza formatos distintos para evitar comparar una botella de 700 ml directamente con una de 750 ml.</p>
            </div>
            <div className={styles.chip}>Mercado Perú</div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Segmento</th>
                  <th>Portafolio Don Luis</th>
                  <th>S/ por litro</th>
                  <th>Referencia competitiva</th>
                  <th>S/ por litro</th>
                  <th>Brecha</th>
                </tr>
              </thead>
              <tbody>
                {benchmarkRows.map((row) => (
                  <tr key={row.product}>
                    <td><strong>{row.product}</strong></td>
                    <td>
                      <strong>{row.piwenPack}</strong>
                      <small>{row.piwenPrice}</small>
                    </td>
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

        <section className={styles.panel} style={{ marginTop: 18 }}>
          <div className={styles.panelHead}>
            <div>
              <span>04 · DIGITAL SHELF</span>
              <h2>Cobertura observable del portafolio por cadena</h2>
              <p>Una ausencia pública puede ser una oportunidad de distribución o una alerta de disponibilidad. La versión productiva distinguiría entre no listado y temporalmente sin stock.</p>
            </div>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Marca</th><th>Tottus</th><th>Metro</th><th>Wong</th><th>Vivanda</th><th>Plaza Vea / Makro</th></tr></thead>
              <tbody>{coverage.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={index}><strong>{cell}</strong></td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className={styles.aiSection}>
          <div className={styles.aiIntro}>
            <span>05 · ASISTENTE DE PRICING</span>
            <h2>Preguntas que Don Luis podría hacerle al sistema</h2>
            <p>La capa de IA toma las observaciones públicas y las transforma en decisiones para pricing, trade marketing, ventas y gerencia.</p>
          </div>
          <div className={styles.prompts}>
            <div><span>↗</span>¿Qué retailer tiene hoy el menor precio de Cuatro Gallos Quebranta?</div>
            <div><span>↗</span>¿Dónde Mandatario está perdiendo paridad frente a otras cadenas?</div>
            <div><span>↗</span>¿Cómo está E. Copello frente a vinos nacionales de entrada?</div>
            <div><span>↗</span>¿Qué marcas del portafolio tienen gaps de distribución digital?</div>
          </div>
        </section>

        <section className={styles.valueSection}>
          <div>
            <span>LO QUE PODRÍAMOS AUTOMATIZAR</span>
            <h2>De revisar webs manualmente a administrar el mercado peruano desde un solo panel.</h2>
          </div>
          <div className={styles.valueGrid}>
            <article><b>01</b><strong>Monitoreo diario</strong><p>Tottus, Metro, Wong, Vivanda, Plaza Vea y otras cadenas relevantes.</p></article>
            <article><b>02</b><strong>Precio comparable</strong><p>S/ por litro, botella equivalente y segmentación por calidad o añejamiento.</p></article>
            <article><b>03</b><strong>Promociones</strong><p>Precio regular, precio online, descuentos y mecánicas promocionales.</p></article>
            <article><b>04</b><strong>Distribución</strong><p>Presencia por cadena, gaps de surtido y alertas de stock/listado.</p></article>
          </div>
        </section>

        <footer className={styles.sources}>
          <strong>Fuentes públicas utilizadas en esta demo</strong>
          <p>
            Referencias públicas observadas en Tottus Perú, Metro, Wong, Vivanda y Plaza Vea/Makro durante agosto de 2026.
            Los precios pueden cambiar por ubicación, stock, promociones, medio de pago y fecha. La demo ilustra el producto;
            el servicio productivo automatizaría capturas periódicas y conservaría histórico auditable.
          </p>
          <div>
            <a href="https://www.tottus.com.pe/tottus-pe/marca/CUATRO%20GALLOS" target="_blank" rel="noreferrer">Tottus · Cuatro Gallos ↗</a>
            <a href="https://www.metro.pe/cuatro-gallos" target="_blank" rel="noreferrer">Metro · Cuatro Gallos ↗</a>
            <a href="https://app.wong.pe/cervezas-vinos-y-licores/licores/pisco/45241" target="_blank" rel="noreferrer">Wong · Pisco ↗</a>
            <a href="https://www.vivanda.com.pe/vinos-licores-y-cervezas/licores/pisco" target="_blank" rel="noreferrer">Vivanda · Pisco ↗</a>
            <a href="https://www.makro.plazavea.com.pe/vinos-licores-y-cervezas/licores/pisco/cuatro-gallos" target="_blank" rel="noreferrer">Plaza Vea/Makro ↗</a>
          </div>
        </footer>
      </main>
    </PageChrome>
  );
}
