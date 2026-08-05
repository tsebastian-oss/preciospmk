"use client";

import { useEffect, useMemo, useState } from "react";

type ContextData = { activeOrganizationId?: string | null };
type ReportJob = {
  id: string;
  report_type: string;
  format: string;
  status: "queued" | "processing" | "completed" | "failed" | "expired";
  requested_at: string;
  completed_at?: string | null;
  result_url?: string | null;
  error_message?: string | null;
  result_metadata?: { rows?: number; bytes?: number; expiresAt?: string } | null;
};

const date = new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short" });

export default function EnterpriseReportCenter() {
  const [organizationId, setOrganizationId] = useState("");
  const [reports, setReports] = useState<ReportJob[]>([]);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(window.location.pathname.startsWith("/enterprise"));
    fetch("/api/enterprise/context", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<ContextData> : null)
      .then((context) => setOrganizationId(context?.activeOrganizationId ?? ""))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!organizationId || !visible) return;
    let active = true;
    const load = () => fetch(`/api/enterprise/reports?organizationId=${encodeURIComponent(organizationId)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<ReportJob[]> : null)
      .then((data) => { if (active && data) setReports(data); })
      .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [organizationId, visible]);

  const activeReports = useMemo(() => reports.filter((report) => ["queued", "processing"].includes(report.status)).length, [reports]);
  const completed = useMemo(() => reports.filter((report) => report.status === "completed" && report.result_url).slice(0, 10), [reports]);

  if (!visible || !organizationId) return null;

  return <>
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      style={{ position: "fixed", right: 24, bottom: 24, zIndex: 1450, display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", border: "1px solid rgba(255,255,255,.12)", borderRadius: 999, color: "#fff", background: "linear-gradient(135deg,#d948ff,#7b61ff)", boxShadow: "0 18px 45px rgba(0,0,0,.35)", fontSize: 9, fontWeight: 900 }}
    >
      REPORTES
      <b style={{ minWidth: 21, padding: "3px 6px", borderRadius: 999, background: "rgba(0,0,0,.18)", fontSize: 8 }}>{activeReports || completed.length}</b>
    </button>

    {open && <aside style={{ position: "fixed", right: 24, bottom: 78, zIndex: 1450, width: "min(430px,calc(100vw - 32px))", maxHeight: "68vh", overflow: "auto", padding: 16, border: "1px solid rgba(255,255,255,.12)", borderRadius: 18, color: "#fff", background: "linear-gradient(145deg,#181825,#0e0e18)", boxShadow: "0 28px 80px rgba(0,0,0,.48)", fontFamily: "Inter,system-ui,sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", marginBottom: 13 }}><div><span style={{ color: "#d988f2", fontSize: 8, fontWeight: 900, letterSpacing: ".1em" }}>PRIVATE REPORT STORAGE</span><h3 style={{ margin: "6px 0 0", fontSize: 17 }}>Entregables generados</h3></div><button onClick={() => setOpen(false)} style={{ border: 0, color: "#aaa9ba", background: "transparent", fontSize: 20 }}>×</button></div>

      {activeReports > 0 && <div style={{ marginBottom: 10, padding: 10, border: "1px solid rgba(255,189,123,.16)", borderRadius: 10, color: "#ffcb98", background: "rgba(255,189,123,.05)", fontSize: 8 }}>{activeReports} reporte(s) en generación. El panel se actualiza automáticamente.</div>}

      <div style={{ display: "grid", gap: 8 }}>
        {reports.slice(0, 15).map((report) => <article key={report.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", padding: 11, border: "1px solid rgba(255,255,255,.07)", borderRadius: 11, background: "rgba(255,255,255,.02)" }}>
          <div><strong style={{ display: "block", fontSize: 9, textTransform: "uppercase" }}>{report.report_type.replaceAll("_", " ")}</strong><span style={{ display: "block", marginTop: 4, color: "#7f7e91", fontSize: 7 }}>{report.format.toUpperCase()} · {date.format(new Date(report.requested_at))}{report.result_metadata?.rows !== undefined ? ` · ${report.result_metadata.rows} filas` : ""}</span>{report.error_message && <small style={{ display: "block", marginTop: 5, color: "#ff9dac", fontSize: 7 }}>{report.error_message}</small>}</div>
          {report.status === "completed" && report.result_url
            ? <a href={report.result_url} target="_blank" rel="noreferrer" style={{ padding: "7px 9px", borderRadius: 8, color: "#6ff0b2", background: "rgba(111,240,178,.07)", textDecoration: "none", fontSize: 7, fontWeight: 900 }}>DESCARGAR</a>
            : <b style={{ padding: "5px 7px", borderRadius: 999, color: report.status === "failed" ? "#ff9dac" : "#ffca95", background: report.status === "failed" ? "rgba(255,130,148,.07)" : "rgba(255,189,123,.07)", fontSize: 7, textTransform: "uppercase" }}>{report.status}</b>}
        </article>)}
      </div>
      {!reports.length && <div style={{ padding: 30, textAlign: "center", color: "#858497", border: "1px dashed rgba(255,255,255,.09)", borderRadius: 12, fontSize: 9 }}>Solicita el primer reporte desde Report Center.</div>}
    </aside>}
  </>;
}
