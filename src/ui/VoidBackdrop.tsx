import { useEffect, useRef } from 'react';

/**
 * The void between the two sorcerers: slow-turning starfield over drifting nebula.
 * One fixed canvas behind the whole app. Capped at ~30 fps and 1.5× pixel ratio so phones stay cool;
 * stops while the tab is hidden and draws a single still frame when the device asks for reduced motion.
 */
export function VoidBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext('2d')!;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0, h = 0, dpr = 1, raf = 0, last = 0;
    let neb: HTMLCanvasElement | null = null;
    type Star = { a: number; r: number; z: number; tw: number; hue: number };
    let stars: Star[] = [];

    const rand = mulberry(7);
    function build() {
      dpr = Math.min(1.5, devicePixelRatio || 1);
      w = innerWidth; h = innerHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      // stars on a disc around the centre of the realm; they turn very slowly
      const R = Math.hypot(w, h) * 0.62; const n = Math.round(Math.min(900, (w * h) / 2400));
      stars = Array.from({ length: n }, () => ({ a: rand() * Math.PI * 2, r: Math.sqrt(rand()) * R, z: rand() ** 2.2, tw: rand() * Math.PI * 2, hue: rand() < 0.18 ? 280 : rand() < 0.4 ? 190 : 45 }));
      // nebula is painted once per resize and only moved afterwards
      neb = document.createElement('canvas'); const nw = Math.ceil(w / 3), nh = Math.ceil(h / 3);
      neb.width = nw; neb.height = nh; const n2 = neb.getContext('2d')!;
      const blobs: [number, number, number, string][] = [
        [0.22, 0.28, 0.55, 'rgba(98, 42, 150, 0.55)'], [0.78, 0.72, 0.6, 'rgba(16, 104, 122, 0.5)'],
        [0.62, 0.18, 0.35, 'rgba(170, 60, 120, 0.28)'], [0.3, 0.8, 0.4, 'rgba(40, 60, 160, 0.4)'],
        [0.5, 0.5, 0.3, 'rgba(210, 160, 80, 0.10)'],
      ];
      n2.globalCompositeOperation = 'lighter';
      for (const [x, y, s, c] of blobs) {
        const g = n2.createRadialGradient(x * nw, y * nh, 0, x * nw, y * nh, s * Math.max(nw, nh));
        g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)'); n2.fillStyle = g; n2.fillRect(0, 0, nw, nh);
      }
    }
    function frame(t: number) {
      raf = requestAnimationFrame(frame);
      if (!still && t - last < 33) return; last = t;
      const T = t / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05040b'; ctx.fillRect(0, 0, w, h);
      // nebula breathes and drifts
      if (neb) {
        ctx.save(); ctx.globalAlpha = 0.85 + 0.15 * Math.sin(T * 0.13);
        ctx.translate(w / 2, h / 2); ctx.rotate(Math.sin(T * 0.02) * 0.08); ctx.scale(1.15 + 0.04 * Math.sin(T * 0.05), 1.15);
        ctx.drawImage(neb, -w / 2, -h / 2, w, h); ctx.restore();
      }
      // stars: far ones turn slower (parallax), all twinkle
      const cx = w / 2, cy = h * 0.46;
      for (const s of stars) {
        const a = s.a + T * (0.004 + s.z * 0.012);
        const x = cx + Math.cos(a) * s.r, y = cy + Math.sin(a) * s.r * 0.72;
        if (x < -2 || y < -2 || x > w + 2 || y > h + 2) continue;
        const tw = 0.55 + 0.45 * Math.sin(T * (0.6 + s.z * 2) + s.tw);
        const size = 0.35 + s.z * 1.5;
        ctx.globalAlpha = (0.25 + s.z * 0.75) * tw;
        ctx.fillStyle = `hsl(${s.hue} 70% ${80 + s.z * 15}%)`;
        ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
        if (s.z > 0.82) { ctx.globalAlpha *= 0.25; ctx.beginPath(); ctx.arc(x, y, size * 3.2, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      // vignette pulls the eye to the realm
      const v = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.25, cx, cy, Math.hypot(w, h) * 0.62);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)'); ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
      if (still) cancelAnimationFrame(raf);
    }
    const onResize = () => { build(); if (still) frame(0); };
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden) raf = requestAnimationFrame(frame); };
    build(); raf = requestAnimationFrame(frame);
    addEventListener('resize', onResize); document.addEventListener('visibilitychange', onVis);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  return <canvas ref={ref} className="void-bg" aria-hidden />;
}

function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
