"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PriceOptimizerWorkspace from "./PriceOptimizerWorkspace";

const HASH = "price-optimizer";

export default function PriceOptimizerPortal() {
  const [navTarget, setNavTarget] = useState<Element | null>(null);
  const [mainTarget, setMainTarget] = useState<Element | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    function resolveTargets() {
      const groups = [...document.querySelectorAll<HTMLElement>('[class*="navGroup"]')];
      const pricingGroup = groups.find((group) =>
        [...group.querySelectorAll("button span")].some((span) => span.textContent?.trim() === "Competitive Analysis"));
      setNavTarget(pricingGroup ?? document.querySelector(".sidebar nav"));
      setMainTarget(document.querySelector(".app-shell > main"));
    }

    function syncHash() {
      setActive(window.location.hash.replace("#", "") === HASH);
    }

    resolveTargets();
    syncHash();
    const timer = window.setTimeout(resolveTargets, 250);
    window.addEventListener("hashchange", syncHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", syncHash);
    };
  }, []);

  useEffect(() => {
    if (!mainTarget) return;
    const children = [...mainTarget.children] as HTMLElement[];
    const previous = children.map((element) => ({ element, display: element.style.display }));
    if (active) children.forEach((element) => { element.style.display = "none"; });
    return () => previous.forEach(({ element, display }) => { element.style.display = display; });
  }, [active, mainTarget]);

  function openOptimizer() {
    window.localStorage.setItem("mgp-intelligence-world", "retailer");
    window.location.hash = HASH;
    setActive(true);
  }

  return <>
    {navTarget && createPortal(
      <button className={active ? "active" : ""} onClick={openOptimizer}>
        <span>AI Price Optimizer</span><em>AI</em>
      </button>,
      navTarget,
    )}
    {active && mainTarget && createPortal(
      <div style={{ width: "100%", minWidth: 0 }}><PriceOptimizerWorkspace /></div>,
      mainTarget,
    )}
  </>;
}
