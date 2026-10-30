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
 *
 * It also measures --viewport-gap: in the installed iPhone app some iOS
 * versions make the page shorter than the screen by the status bar's height
 * while still drawing it from the very top, which leaves an empty strip at
 * the bottom. Full-screen layers extend by that amount.
 */
export function ViewportSync() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;

    // iOS only (navigator.standalone exists only there), installed app only.
    const iosApp = (navigator as Navigator & { standalone?: boolean }).standalone === true;

    const update = () => {
      frame = 0;
      if (iosApp) {
        const portrait = window.innerHeight >= window.innerWidth;
        const full = portrait
          ? Math.max(window.screen.width, window.screen.height)
          : Math.min(window.screen.width, window.screen.height);
        const gap = Math.round(full - window.innerHeight);
        root.style.setProperty("--viewport-gap", `${gap > 0 && gap <= 120 ? gap : 0}px`);
      }
      // Ignore pinch-zoom: the layout should stay put while zoomed.
      if (Math.abs(vv.scale - 1) > 0.01) return;
      root.style.setProperty("--vv-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--vv-top", `${Math.round(vv.offsetTop)}px`);
      // The on-screen keyboard can only be open while something is being typed in.
      const active = document.activeElement;
      const typing =
        active instanceof HTMLElement &&
        (active.isContentEditable || (active.matches("input, textarea, select") && !(active as HTMLInputElement).readOnly));
      const keyboardOpen = typing && window.innerHeight - vv.height > 120;
      if (keyboardOpen) root.dataset.keyboard = "open";
      else delete root.dataset.keyboard;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      root.style.removeProperty("--vv-height");
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--viewport-gap");
      delete root.dataset.keyboard;
    };
  }, []);
  return null;
}
