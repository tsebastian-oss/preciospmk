"use client";

import { useEffect } from "react";

export default function PriceMatchLabelGuard() {
  useEffect(() => {
    const updateLabels = () => {
      document.querySelectorAll<HTMLElement>(".confidence").forEach((element) => {
        if (element.textContent?.includes("Exact match")) {
          element.textContent = "Match validado · alta confianza";
        }
      });

      document.querySelectorAll<HTMLElement>(".metric-card > span").forEach((element) => {
        if (element.textContent?.trim() === "Matches exactos") {
          element.textContent = "Matches comparables";
        }
      });
    };

    updateLabels();
    const observer = new MutationObserver(updateLabels);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
