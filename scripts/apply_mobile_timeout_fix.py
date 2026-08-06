from pathlib import Path

root = Path(__file__).resolve().parents[1]

# 1) Avoid expensive exact counts in interactive catalog endpoints.
supabase = root / "src/lib/supabase.ts"
text = supabase.read_text()
text = text.replace(
    'export type QueryOptions = {\n  method?: "GET" | "POST" | "PATCH";\n  query?: Record<string, string>;\n  body?: unknown;\n  prefer?: string;\n};',
    'export type QueryOptions = {\n  method?: "GET" | "POST" | "PATCH";\n  query?: Record<string, string>;\n  body?: unknown;\n  prefer?: string;\n  countMode?: "exact" | "planned" | "estimated";\n};'
)
text = text.replace(
    'export async function supabaseRestWithCount<T>(\n  path: string,\n  options: QueryOptions = {},\n): Promise<SupabaseResult<T>> {\n  const prefer = [options.prefer, "count=exact"].filter(Boolean).join(",");\n  return supabaseRequest<T>(path, { ...options, prefer });\n}',
    'export async function supabaseRestWithCount<T>(\n  path: string,\n  options: QueryOptions = {},\n): Promise<SupabaseResult<T>> {\n  const { countMode = "planned", ...requestOptions } = options;\n  const prefer = [requestOptions.prefer, `count=${countMode}`].filter(Boolean).join(",");\n  return supabaseRequest<T>(path, { ...requestOptions, prefer });\n}'
)
supabase.write_text(text)

# 2) Load each data family only in the views that actually need it and sanitize DB errors.
app = root / "src/app/UnifiedPlatformApp.tsx"
text = app.read_text()
text = text.replace(
    'function saveFile(url: string) { const anchor = document.createElement("a"); anchor.href = url; anchor.rel = "noreferrer"; document.body.appendChild(anchor); anchor.click(); anchor.remove(); }',
    'function saveFile(url: string) { const anchor = document.createElement("a"); anchor.href = url; anchor.rel = "noreferrer"; document.body.appendChild(anchor); anchor.click(); anchor.remove(); }\nfunction friendlyError(error: unknown, fallback: string) {\n  const message = error instanceof Error ? error.message : String(error ?? "");\n  if (message.includes("57014") || message.toLowerCase().includes("statement timeout")) {\n    return "Una consulta tardó más de lo esperado. La reintentaremos al abrir ese módulo.";\n  }\n  if (message.startsWith("Supabase 500:")) return fallback;\n  return message || fallback;\n}'
)
text = text.replace(
    'setNotice(error instanceof Error ? error.message : "Error cargando la plataforma");',
    'setNotice(friendlyError(error, "Error cargando la plataforma"));'
)
text = text.replace(
    'setNotice(error instanceof Error ? error.message : "Error cargando productos");',
    'setNotice(friendlyError(error, "Error cargando productos"));'
)
text = text.replace(
    'setNotice(error instanceof Error ? error.message : "Error cargando Price Matching");',
    'setNotice(friendlyError(error, "Error cargando Price Matching"));'
)
text = text.replace(
    'setNotice(error instanceof Error ? error.message : "Error cargando la tendencia");',
    'setNotice(friendlyError(error, "Error cargando la tendencia"));'
)
old_effects = '''  useEffect(() => { const timeout = window.setTimeout(() => void loadProducts(), 250); return () => window.clearTimeout(timeout); }, [loadProducts]);
  useEffect(() => { const timeout = window.setTimeout(() => void loadMatches(), 250); return () => window.clearTimeout(timeout); }, [loadMatches]);

  const seriesKey = activeSeries.join("|");
  useEffect(() => {
    if (!activeSeries.length) return;'''
new_effects = '''  const needsProducts = view === "products" || view === "promotions";
  const needsMatches = view === "overview" || view === "price-matching" || view === "competitive" || view === "optimizer" || view === "assortment" || view === "basket";
  const needsTrend = view === "overview" || view === "movements";

  useEffect(() => {
    if (!needsProducts) return;
    const timeout = window.setTimeout(() => void loadProducts(), 250);
    return () => window.clearTimeout(timeout);
  }, [loadProducts, needsProducts]);
  useEffect(() => {
    if (!needsMatches) return;
    const timeout = window.setTimeout(() => void loadMatches(), 250);
    return () => window.clearTimeout(timeout);
  }, [loadMatches, needsMatches]);

  const seriesKey = activeSeries.join("|");
  useEffect(() => {
    if (!needsTrend || !activeSeries.length) return;'''
if old_effects not in text:
    raise SystemExit("Expected effects block not found")
text = text.replace(old_effects, new_effects)
text = text.replace('  }, [filters.period, seriesKey]);', '  }, [filters.period, seriesKey, needsTrend]);')
text = text.replace(
    '  return <div className={styles.app}>\n    <aside className={`${styles.sidebar} ${mobileOpen ? styles.mobileOpen : ""}`}>',
    '  return <div className={styles.app}>\n    {mobileOpen && <button className={styles.mobileBackdrop} aria-label="Cerrar menú" onClick={() => setMobileOpen(false)}/>}\n    <aside className={`${styles.sidebar} ${mobileOpen ? styles.mobileOpen : ""}`}>\n      <button className={styles.sidebarClose} aria-label="Cerrar menú" onClick={() => setMobileOpen(false)}>×</button>'
)
text = text.replace(
    '<button className={styles.menuButton} onClick={() => setMobileOpen((current) => !current)}>☰</button>',
    '<button className={styles.menuButton} aria-label="Abrir menú" aria-expanded={mobileOpen} onClick={() => setMobileOpen((current) => !current)}>☰</button>'
)
app.write_text(text)

# 3) Responsive behavior for phones and tablets.
css = root / "src/app/UnifiedPlatformApp.module.css"
css_text = css.read_text()
append = r'''
.mobileBackdrop,.sidebarClose{display:none}
@media(max-width:1180px){
  .app{display:block;min-height:100dvh}
  .sidebar{position:fixed;inset:0 auto 0 0;width:min(320px,88vw);height:100dvh;padding:22px 16px 24px;transform:translateX(-105%);transition:transform .24s ease;box-shadow:18px 0 45px rgba(4,20,46,.32);z-index:70}
  .sidebar.mobileOpen{left:0;transform:translateX(0)}
  .brand{justify-content:flex-start;padding-left:8px;padding-right:44px}
  .brand>span:last-child,.navGroup h3,.navGroup button>span,.account{display:block}
  .navGroup button{justify-content:flex-start;min-height:46px}
  .sidebarClose{display:grid;place-items:center;position:absolute;top:16px;right:14px;width:38px;height:38px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:rgba(255,255,255,.08);color:#fff;font-size:25px;line-height:1;z-index:2}
  .mobileBackdrop{display:block;position:fixed;inset:0;border:0;background:rgba(4,15,34,.55);backdrop-filter:blur(3px);z-index:60}
  .main{padding:0 20px 36px}
  .topbar{grid-template-columns:auto minmax(0,1fr) auto;min-height:auto;padding:20px 0 14px}
  .menuButton{display:block;width:46px;height:46px;font-size:18px}
  .search{grid-column:1/-1;height:48px}
  .headerControl{display:none}
  .filters{grid-template-columns:repeat(3,minmax(0,1fr));padding:16px;gap:12px}
  .typeFilter{grid-column:1/-1}
  .filters select,.typeFilter button,.clear{min-height:44px}
  .metrics{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .overviewGrid{grid-template-columns:1fr;grid-template-areas:"variation" "match" "rail" "trend"}
  .sideRail{grid-template-columns:repeat(3,minmax(0,1fr))}
  .twoColumn,.optimizerGrid,.basketGrid,.downloadGrid,.settingsGrid{grid-template-columns:1fr}
  .categoryCards{grid-template-columns:repeat(2,minmax(0,1fr))}
  .retailerCards{grid-template-columns:repeat(2,minmax(0,1fr))}
  .tableWrap{-webkit-overflow-scrolling:touch}
}
@media(max-width:760px){
  .main{padding:0 14px calc(28px + env(safe-area-inset-bottom))}
  .topbar{grid-template-columns:auto minmax(0,1fr);gap:12px;padding-top:max(16px,env(safe-area-inset-top))}
  .pageTitle>span{font-size:11px}
  .pageTitle h1{font-size:28px;line-height:1.08}
  .pageTitle p{font-size:14px;line-height:1.45}
  .search{height:52px;border-radius:13px}
  .search input{font-size:16px}
  .notice{font-size:13px;line-height:1.45;word-break:break-word}
  .filters{grid-template-columns:1fr 1fr;border-radius:16px;padding:16px;gap:13px}
  .typeFilter>div{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .typeFilter button{width:100%;padding:0 8px;font-size:12px}
  .filters label>span,.typeFilter>span{font-size:12px}
  .filters select,.clear{height:48px;font-size:14px;border-radius:11px}
  .metrics{grid-template-columns:1fr 1fr;gap:11px}
  .metric{min-height:112px;padding:15px;align-items:flex-start}
  .metricDot{width:42px;height:42px;flex-basis:42px}
  .metric strong{font-size:24px}
  .metric span{font-size:12px}
  .metric small{font-size:11px;line-height:1.35}
  .card{border-radius:16px}
  .cardHead{padding:18px 17px 13px}
  .cardHead h2{font-size:18px}
  .cardHead p{font-size:12px;line-height:1.4}
  .sideRail{grid-template-columns:1fr}
  .barChart{height:310px;margin:0 10px;padding-left:44px;overflow-x:auto;-webkit-overflow-scrolling:touch}
  .barItems{min-width:560px}
  .ringRow{gap:4px;padding-left:10px;padding-right:10px}
  .ringMetric>div{width:68px;height:68px}
  .miniTable button{grid-template-columns:minmax(0,1fr) 74px 68px}
  .trendWrap{padding:0 10px 14px;overflow:auto;-webkit-overflow-scrolling:touch}
  .trendSvg{min-width:620px}
  .listingGrid,.formGrid,.exportForm,.formatSelector,.recommendationCard>div{grid-template-columns:1fr}
  .toolbar{align-items:stretch;flex-direction:column}
  .toolbar select{width:100%;min-width:0;height:46px}
  .toolbar span{margin-left:0}
  .scrapeRows>div{grid-template-columns:minmax(0,1fr) 90px}
  .scrapeRows>div strong,.scrapeRows>div small{display:none}
  .tableWrap table{min-width:760px}
  .pagination{gap:8px;justify-content:space-between}
  .pagination button{padding:0 10px;min-height:42px}
}
@media(max-width:480px){
  .main{padding-left:12px;padding-right:12px}
  .topbar{gap:10px}
  .menuButton{width:44px;height:44px}
  .pageTitle h1{font-size:25px}
  .filters{grid-template-columns:1fr}
  .typeFilter{grid-column:1}
  .clear{width:100%}
  .metrics{grid-template-columns:1fr}
  .metric{min-height:90px;align-items:center}
  .metric strong{font-size:27px}
  .ringRow{grid-template-columns:repeat(3,minmax(0,1fr))}
  .ringMetric>div{width:62px;height:62px}
  .ringMetric strong{font-size:10px}
  .miniTable button{grid-template-columns:minmax(0,1fr) 64px}
  .miniTable button em{display:none}
  .categoryCards,.retailerCards{grid-template-columns:1fr}
  .alertCard{grid-template-columns:10px minmax(0,1fr)}
  .alertCard>button{grid-column:2;justify-self:start}
}
'''
if append.strip() not in css_text:
    css.write_text(css_text + append)

# 4) Correct mobile viewport and safe-area rendering.
layout = root / "src/app/layout.tsx"
layout_text = layout.read_text()
layout_text = layout_text.replace('import "./globals.css";\n', 'import type { Viewport } from "next";\nimport "./globals.css";\n')
layout_text = layout_text.replace('export const metadata = {', 'export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };\n\nexport const metadata = {')
layout.write_text(layout_text)

# Remove the one-time automation from the resulting commit.
(root / ".github/workflows/apply-mobile-timeout-fix.yml").unlink(missing_ok=True)
Path(__file__).unlink(missing_ok=True)
