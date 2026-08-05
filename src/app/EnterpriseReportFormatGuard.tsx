"use client";

import { useEffect } from "react";

export default function EnterpriseReportFormatGuard() {
  useEffect(() => {
    if (!window.location.pathname.startsWith("/enterprise")) return;
    const apply = () => {
      document.querySelectorAll<HTMLOptionElement>('select[name="format"] option[value="pptx"]').forEach((option) => option.remove());
      document.querySelectorAll<HTMLElement>("form small").forEach((element) => {
        if (element.textContent?.includes("generadores de archivos se conectarán")) {
          element.textContent = "PDF, Excel y CSV se generan en un bucket privado con enlace temporal y trazabilidad completa.";
        }
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
