"use client";

import { useEffect } from "react";

/**
 * Keeps full-screen layouts (the chat) exactly inside the visible area.
 *
 * On iPhone/iPad the on-screen keyboard doesn't resize the page; it only
 * shrinks the "visual viewport", so a 100dvh layout ends up partly behind the
 * keyboard. This publishes the visible height/offset as CSS variables
 * (--vv-height, --vv-top) and marks html[data-keyboard="open"]. Android
 * resizes the page itself (viewport interactive-widget=resizes-content), where
 * the variables simply match the page.
 */
export function ViewportSync() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;

    const update = () => {
      frame = 0;
      // Ignore pinch-zoom: the layout should stay put while zoomed.
      if (Math.abs(vv.scale - 1) > 0.01) return;
      root.style.setProperty("--vv-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
      const keyboardOpen = window.innerHeight - vv.height > 120;
      if (keyboardOpen) root.dataset.keyboard = "open";
      else delete root.dataset.keyboard;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--vv-top");
      delete root.dataset.keyboard;
    };
  }, []);
  return null;
}
