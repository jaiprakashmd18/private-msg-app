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
 * Some iOS versions size the installed app's view as if the status bar took
 * space, yet draw it from the very top, so the view ends above the home
 * indicator while still reporting a bottom safe area. Then
 * html[data-short-view] drops that (now pointless) bottom padding. The app
 * uses a black, non-translucent status bar so newly installed copies avoid
 * this entirely.
 */
export function ViewportSync() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;

    // iOS only (navigator.standalone exists only there), installed app only.
    const iosApp = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;visibility:hidden;height:env(safe-area-inset-top)";
    if (iosApp) document.body.appendChild(probe);

    const update = () => {
      frame = 0;
      if (iosApp) {
        const portrait = window.innerHeight >= window.innerWidth;
        const full = portrait
          ? Math.max(window.screen.width, window.screen.height)
          : Math.min(window.screen.width, window.screen.height);
        const gap = full - window.innerHeight;
        const statusBar = probe.getBoundingClientRect().height;
        // Drawn under the status bar (statusBar > 0) but shorter by its height.
        if (statusBar > 0 && Math.abs(gap - statusBar) <= 3) root.dataset.shortView = "";
        else delete root.dataset.shortView;
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
      delete root.dataset.shortView;
      probe.remove();
      delete root.dataset.keyboard;
    };
  }, []);
  return null;
}
