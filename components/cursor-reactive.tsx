"use client";

import { useEffect } from "react";

export function CursorReactive() {
  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!finePointer || reducedMotion) return;
    let activeElement: HTMLElement | null = null;
    let raf = 0;
    let latestX = 0;
    let latestY = 0;
    const update = () => {
      document.documentElement.style.setProperty("--cursor-x", latestX + "px");
      document.documentElement.style.setProperty("--cursor-y", latestY + "px");
      const target = document.elementFromPoint(latestX, latestY)?.closest<HTMLElement>("[data-cursor-reactive]") ?? null;
      if (activeElement && activeElement !== target) {
        activeElement.classList.remove("cursor-tracking");
        activeElement.style.setProperty("--tilt-x", "0deg");
        activeElement.style.setProperty("--tilt-y", "0deg");
      }
      activeElement = target;
      if (target) {
        const rect = target.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (latestX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (latestY - rect.top) / rect.height));
        target.style.setProperty("--glow-x", (x * 100) + "%");
        target.style.setProperty("--glow-y", (y * 100) + "%");
        target.style.setProperty("--tilt-y", ((x - 0.5) * 2.2) + "deg");
        target.style.setProperty("--tilt-x", ((0.5 - y) * 2.2) + "deg");
        target.classList.add("cursor-tracking");
      }
      raf = 0;
    };
    const onPointerMove = (event: PointerEvent) => {
      latestX = event.clientX;
      latestY = event.clientY;
      document.body.classList.add("cursor-present");
      if (!raf) raf = window.requestAnimationFrame(update);
    };
    const onPointerLeave = () => {
      document.body.classList.remove("cursor-present");
      if (activeElement) {
        activeElement.classList.remove("cursor-tracking");
        activeElement.style.setProperty("--tilt-x", "0deg");
        activeElement.style.setProperty("--tilt-y", "0deg");
        activeElement = null;
      }
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onPointerLeave);
      if (raf) window.cancelAnimationFrame(raf);
      document.body.classList.remove("cursor-present");
    };
  }, []);
  return <div className="cursor-aura" aria-hidden="true" />;
}
