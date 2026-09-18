"use client";

import { useEffect, useRef } from "react";

/**
 * Live input level while recording (DESIGN_BRIEF §5.2 / §6 `Waveform`).
 * Plain bars in the accent color — no glow, no gradient, nothing bouncing.
 */
export function Waveform({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#A84B28";
    const line = getComputedStyle(document.documentElement).getPropertyValue("--line").trim() || "#E2DBCF";

    const bars = 32;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();

    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = (levels: number[]) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const gap = 3 * dpr;
      const barWidth = (w - gap * (bars - 1)) / bars;
      for (let i = 0; i < bars; i += 1) {
        const level = Math.max(0.06, Math.min(1, levels[i] ?? 0));
        const barHeight = level * h;
        ctx.fillStyle = active ? accent : line;
        ctx.globalAlpha = active ? 0.9 : 0.6;
        const x = i * (barWidth + gap);
        const y = (h - barHeight) / 2;
        const r = Math.min(barWidth / 2, 2 * dpr);
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, r);
        ctx.fill();
      }
    };

    if (!active || !analyser || !data || reduced) {
      draw(new Array(bars).fill(active ? 0.25 : 0.12));
      return;
    }

    let frame = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const step = Math.floor(data.length / bars) || 1;
      const levels: number[] = [];
      for (let i = 0; i < bars; i += 1) {
        let sum = 0;
        for (let j = 0; j < step; j += 1) sum += data[i * step + j] ?? 0;
        levels.push(sum / step / 255);
      }
      draw(levels);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [analyser, active]);

  return <canvas ref={canvasRef} aria-hidden className="h-14 w-full" />;
}
