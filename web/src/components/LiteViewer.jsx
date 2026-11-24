import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Contrast, Layers, Move, ZoomIn, Ruler, SunMoon, RotateCcw, Trash2, ChevronUp, ChevronDown, Info,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtDate } from '../lib/format.js';
import { Spinner } from './ui.jsx';

const CT_PRESETS = [
  ['Parties molles', 40, 400],
  ['Poumon', -600, 1500],
  ['Médiastin', 50, 350],
  ['Os', 400, 1800],
  ['Cerveau', 40, 80],
  ['Foie', 60, 160],
];

const TOOLS = [
  { key: 'wl', label: 'Fenêtre', icon: Contrast, hint: 'Glisser : ↔ largeur, ↕ niveau' },
  { key: 'scroll', label: 'Coupes', icon: Layers, hint: 'Glisser ↕ pour défiler' },
  { key: 'pan', label: 'Déplacer', icon: Move },
  { key: 'zoom', label: 'Zoom', icon: ZoomIn, hint: 'Glisser ↕' },
  { key: 'measure', label: 'Mesure', icon: Ruler, hint: 'Glisser pour mesurer' },
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/**
 * WebGL-free viewer: frames are rendered (and windowed) by Orthanc, displayed as images.
 * Live window/level feedback uses an exact SVG linear filter on the current image, then the
 * correctly windowed frame is fetched once the drag settles.
 */
export default function LiteViewer({ manifestUrl, imageBase, onBack, backLabel = 'Retour' }) {
  const [m, setM] = useState(null);
  const [error, setError] = useState(null);
  const [si, setSi] = useState(0);
  const [pos, setPos] = useState({});
  const [win, setWin] = useState({}); // live window per series
  const [committed, setCommitted] = useState({}); // window used to fetch frames
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const [invert, setInvert] = useState(false);
  const [tool, setTool] = useState(isTouch ? 'scroll' : 'wl');
  const [measures, setMeasures] = useState({});
  const [draft, setDraft] = useState(null);
  const [shown, setShown] = useState(null);
  const [nat, setNat] = useState(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [imgError, setImgError] = useState(false);
  const [help, setHelp] = useState(false);

  const stageRef = useRef();
  const wrapRef = useRef();
  const drag = useRef(null);

  useEffect(() => {
    api
      .get(manifestUrl)
      .then((data) => {
        const w = {};
        for (const s of data.series) w[s.id] = s.window || s.fallbackWindow;
        setWin(w);
        setCommitted(w);
        setM(data);
      })
      .catch(setError);
  }, [manifestUrl]);

  const s = m?.series[si];
  const n = s?.slices.length || 0;
  const idx = s ? clamp(pos[s.id] ?? 0, 0, n - 1) : 0;
  const lw = s ? win[s.id] : null;
  const cw = s ? committed[s.id] : null;

  const urlFor = useCallback(
    (series, i, w, extra = '') => {
      const [iid, f] = series.slices[i];
      const p = new URLSearchParams();
      if (series.windowable && w) {
        p.set('wc', String(Math.round(w.c)));
        p.set('ww', String(Math.max(1, Math.round(w.w))));
      }
      return `${imageBase}/${iid}/${f}?${p}${extra}`;
    },
    [imageBase]
  );

  const desired = s ? urlFor(s, idx, cw) : null;

  // Preload the wanted frame, swap when ready (no flicker); prefetch neighbours
  useEffect(() => {
    if (!s || !desired) return;
    let cancelled = false;
    const img = new Image();
    const prefetch = [];
    img.onload = () => {
      if (cancelled) return;
      setShown({ url: desired, c: cw?.c, w: cw?.w, sid: s.id });
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
      setImgError(false);
    };
    img.onerror = () => !cancelled && setImgError(true);
    img.src = desired;
    // Prefetch neighbours only once scrolling pauses, so the wanted frame is never stuck behind them
    const t = setTimeout(() => {
      for (const d of [1, -1, 2, 3, -2]) {
        const j = idx + d;
        if (j >= 0 && j < n) {
          const p = new Image();
          p.src = urlFor(s, j, cw);
          prefetch.push(p);
        }
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (!img.complete) img.src = ''; // abort a frame we scrolled past
      prefetch.forEach((p) => !p.complete && (p.src = ''));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desired]);

  // Commit the live window after the drag settles
  useEffect(() => {
    if (!s || !lw) return;
    if (cw && lw.c === cw.c && lw.w === cw.w) return;
    const t = setTimeout(() => setCommitted((c) => ({ ...c, [s.id]: lw })), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lw?.c, lw?.w, s?.id]);

  // Stage size
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [m]);

  const step = useCallback(
    (d) => {
      if (!s) return;
      setPos((p) => ({ ...p, [s.id]: clamp((p[s.id] ?? 0) + d, 0, s.slices.length - 1) }));
      setDraft(null);
    },
    [s]
  );

  const reset = useCallback(() => {
    if (!s) return;
    const def = s.window || s.fallbackWindow;
    setView({ zoom: 1, x: 0, y: 0 });
    setWin((w) => ({ ...w, [s.id]: def }));
    setCommitted((c) => ({ ...c, [s.id]: def }));
    setInvert(false);
  }, [s]);

  const setWindow = (c, w) => {
    if (!s?.windowable) return;
    setWin((x) => ({ ...x, [s.id]: { c, w } }));
    setCommitted((x) => ({ ...x, [s.id]: { c, w } }));
  };

  // Wheel: slices (Ctrl/⌘ + wheel: zoom). Needs a non-passive listener.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) setView((v) => ({ ...v, zoom: clamp(v.zoom * Math.exp(-e.deltaY * 0.002), 0.25, 12) }));
      else step(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [step, m]);

  // Keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const map = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, PageDown: 10, PageUp: -10 };
      if (map[e.key]) {
        e.preventDefault();
        step(map[e.key]);
      } else if (e.key === 'Home') step(-1e6);
      else if (e.key === 'End') step(1e6);
      else if (e.key === 'r') reset();
      else if (e.key === 'i') setInvert((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, reset]);

  const fit = nat && box.w ? Math.min(box.w / nat.w, box.h / nat.h) * 0.98 : 1;

  function toImg(e) {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r || !nat) return null;
    return {
      x: clamp(((e.clientX - r.left) / r.width) * nat.w, 0, nat.w),
      y: clamp(((e.clientY - r.top) / r.height) * nat.h, 0, nat.h),
    };
  }

  function onPointerDown(e) {
    if (!s) return;
    stageRef.current.setPointerCapture(e.pointerId);
    const t = e.button === 2 ? 'zoom' : e.button === 1 ? 'pan' : tool;
    drag.current = { t, x: e.clientX, y: e.clientY, acc: 0 };
    if (t === 'measure') {
      const p = toImg(e);
      if (p) setDraft({ a: p, b: p });
    }
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d || !s) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.t === 'wl' && s.windowable) {
      setWin((w) => {
        const cur = w[s.id];
        const k = Math.max(0.5, cur.w / 300);
        return { ...w, [s.id]: { c: cur.c + dy * k, w: Math.max(1, cur.w + dx * k) } };
      });
    } else if (d.t === 'pan') {
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (d.t === 'zoom') {
      setView((v) => ({ ...v, zoom: clamp(v.zoom * Math.exp(-dy * 0.01), 0.25, 12) }));
    } else if (d.t === 'scroll') {
      d.acc += dy;
      const px = Math.max(3, 300 / n);
      while (Math.abs(d.acc) >= px) {
        step(d.acc > 0 ? 1 : -1);
        d.acc -= Math.sign(d.acc) * px;
      }
    } else if (d.t === 'measure') {
      const p = toImg(e);
      if (p) setDraft((x) => x && { ...x, b: p });
    }
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d || !s) return;
    if (d.t === 'measure' && draft) {
      if (Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) > 2) {
        const key = `${s.id}:${idx}`;
        setMeasures((ms) => ({ ...ms, [key]: [...(ms[key] || []), draft] }));
      }
      setDraft(null);
    }
    if (d.t === 'wl' && lw) setCommitted((c) => ({ ...c, [s.id]: lw }));
  }

  const lengthLabel = (a, b) => {
    if (!nat) return '';
    const dx = (b.x - a.x) * (s.columns ? s.columns / nat.w : 1);
    const dy = (b.y - a.y) * (s.rows ? s.rows / nat.h : 1);
    if (s.pixelSpacing) {
      const [rowSp, colSp] = s.pixelSpacing;
      return `${Math.hypot(dx * colSp, dy * rowSp).toFixed(1)} mm`;
    }
    return `${Math.hypot(dx, dy).toFixed(0)} px`;
  };

  // Exact live window/level: y' = a·y + b applied to the image rendered with the committed window
  const filter = useMemo(() => {
    let a = 1, b = 0;
    if (s?.windowable && shown?.sid === s.id && shown.w && lw) {
      a = shown.w / lw.w;
      b = (shown.c - lw.c + (lw.w - shown.w) / 2) / lw.w;
    }
    if (invert) {
      a = -a;
      b = 1 - b;
    }
    return { a, b, active: a !== 1 || b !== 0 };
  }, [s, shown, lw, invert]);

  if (error)
    return (
      <Shell onBack={onBack} backLabel={backLabel}>
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-ink-soft">{error.message}</div>
      </Shell>
    );
  if (!m)
    return (
      <Shell onBack={onBack} backLabel={backLabel}>
        <div className="flex flex-1 items-center justify-center"><Spinner className="h-6 w-6 text-brand-600" /></div>
      </Shell>
    );
  if (!m.series.length)
    return (
      <Shell onBack={onBack} backLabel={backLabel} title={m.title}>
        <div className="flex flex-1 items-center justify-center text-sm text-ink-soft">Aucune image affichable dans cet examen.</div>
      </Shell>
    );

  const k = 1 / (fit * view.zoom);
  const current = measures[`${s.id}:${idx}`] || [];
  const all = draft ? [...current, draft] : current;
  const loading = shown?.url !== desired && !imgError;

  return (
    <Shell onBack={onBack} backLabel={backLabel} title={m.title} subtitle={[m.patient, m.date && fmtDate(m.date)].filter(Boolean).join(' · ')}
      toolbar={
        <>
          <div className="flex rounded-lg border border-paper-line bg-paper p-0.5">
            {TOOLS.map((t) => (
              <button key={t.key} title={t.hint || t.label} disabled={t.key === 'wl' && !s.windowable}
                onClick={() => setTool(t.key)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs disabled:opacity-40 ${tool === t.key ? 'bg-white font-medium text-brand-700 shadow-card' : 'text-ink-soft'}`}>
                <t.icon className="h-4 w-4" /> <span className="hidden lg:inline">{t.label}</span>
              </button>
            ))}
          </div>
          {s.windowable && (
            <select className="input w-auto py-1.5 text-xs" value=""
              onChange={(e) => {
                if (e.target.value === 'default') { const d = s.window || s.fallbackWindow; setWindow(d.c, d.w); }
                else { const [, c, w] = CT_PRESETS[Number(e.target.value)]; setWindow(c, w); }
              }}>
              <option value="" disabled>Fenêtrage…</option>
              <option value="default">Par défaut</option>
              {s.modality === 'CT' && CT_PRESETS.map(([l, c, w], i) => <option key={l} value={i}>{l} ({c}/{w})</option>)}
            </select>
          )}
          <IconBtn title="Inverser (i)" active={invert} onClick={() => setInvert((v) => !v)} icon={SunMoon} />
          <IconBtn title="Réinitialiser (r)" onClick={reset} icon={RotateCcw} />
          {current.length > 0 && <IconBtn title="Effacer les mesures" onClick={() => setMeasures((ms) => ({ ...ms, [`${s.id}:${idx}`]: [] }))} icon={Trash2} />}
          <IconBtn title="Aide" active={help} onClick={() => setHelp((v) => !v)} icon={Info} />
          {m.series.length > 1 && (
            <select className="input w-auto py-1.5 text-xs md:hidden" value={si} onChange={(e) => { setSi(Number(e.target.value)); setView({ zoom: 1, x: 0, y: 0 }); }}>
              {m.series.map((x, i) => <option key={x.id} value={i}>S{x.number ?? i + 1} · {x.description || x.modality}</option>)}
            </select>
          )}
        </>
      }>
      <div className="flex min-h-0 flex-1">
        {m.series.length > 1 && (
          <aside className="hidden w-40 shrink-0 flex-col gap-2 overflow-y-auto border-r border-paper-line bg-white p-2 md:flex">
            {m.series.map((x, i) => (
              <button key={x.id} onClick={() => { setSi(i); setView({ zoom: 1, x: 0, y: 0 }); setDraft(null); }}
                className={`overflow-hidden rounded-lg border text-left ${i === si ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-paper-line hover:border-ink-mute/40'}`}>
                <div className="aspect-square bg-black">
                  <img alt="" loading="lazy" className="h-full w-full object-contain" src={urlFor(x, Math.floor(x.slices.length / 2), x.window || x.fallbackWindow, '&h=160')} />
                </div>
                <div className="px-2 py-1.5">
                  <p className="truncate text-xs font-medium">{x.description || `Série ${x.number ?? i + 1}`}</p>
                  <p className="text-[11px] text-ink-mute">{x.modality} · {x.slices.length} im.</p>
                </div>
              </button>
            ))}
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onContextMenu={(e) => e.preventDefault()} onDoubleClick={() => setView({ zoom: 1, x: 0, y: 0 })}
            className="relative flex-1 touch-none select-none overflow-hidden bg-black"
            style={{ cursor: { wl: 'crosshair', pan: 'grab', zoom: 'zoom-in', scroll: 'ns-resize', measure: 'crosshair' }[tool] }}>
            <svg width="0" height="0" className="absolute">
              <filter id="rk-wl" colorInterpolationFilters="sRGB">
                <feComponentTransfer>
                  <feFuncR type="linear" slope={filter.a} intercept={filter.b} />
                  <feFuncG type="linear" slope={filter.a} intercept={filter.b} />
                  <feFuncB type="linear" slope={filter.a} intercept={filter.b} />
                </feComponentTransfer>
              </filter>
            </svg>

            {shown && nat && (
              <div ref={wrapRef} className="absolute left-1/2 top-1/2"
                style={{ width: nat.w * fit, height: nat.h * fit, transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
                <img src={shown.url} alt="" draggable={false} className="h-full w-full"
                  style={{ imageRendering: view.zoom * fit > 2 ? 'pixelated' : 'auto', filter: filter.active ? 'url(#rk-wl)' : 'none' }} />
                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${nat.w} ${nat.h}`} preserveAspectRatio="none">
                  {all.map((ms, i) => (
                    <g key={i}>
                      <line x1={ms.a.x} y1={ms.a.y} x2={ms.b.x} y2={ms.b.y} stroke="#fbbf24" strokeWidth={1.5 * k} />
                      {[ms.a, ms.b].map((p, j) => <circle key={j} cx={p.x} cy={p.y} r={3 * k} fill="#fbbf24" />)}
                      <text x={ms.b.x + 6 * k} y={ms.b.y - 6 * k} fill="#fbbf24" fontSize={13 * k} fontFamily="IBM Plex Mono, monospace"
                        stroke="black" strokeWidth={3 * k} paintOrder="stroke">{lengthLabel(ms.a, ms.b)}</text>
                    </g>
                  ))}
                </svg>
              </div>
            )}

            {/* corner overlays */}
            <div className="pointer-events-none absolute left-3 top-2 font-mono text-[11px] leading-relaxed text-white/80">
              <p>{s.modality} · S{s.number ?? si + 1}</p>
              {s.description && <p>{s.description}</p>}
            </div>
            <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[11px] leading-relaxed text-white/80">
              <p>Im {idx + 1} / {n}</p>
              {s.windowable && lw && <p>F {Math.round(lw.w)} / N {Math.round(lw.c)}</p>}
            </div>
            <div className="pointer-events-none absolute bottom-2 right-3 text-right font-mono text-[11px] text-white/80">
              <p>{Math.round(fit * view.zoom * 100)} %</p>
            </div>
            {loading && <div className="absolute right-3 top-3 text-white/70"><Spinner className="h-4 w-4" /></div>}
            {imgError && (
              <div className="absolute inset-x-0 top-1/2 text-center text-sm text-white/80">Image indisponible sur le serveur.</div>
            )}
            {help && (
              <div className="absolute right-3 top-10 w-64 rounded-lg bg-white/95 p-3 text-xs text-ink shadow-lg">
                <p className="mb-1 font-semibold">Raccourcis</p>
                <ul className="space-y-0.5 text-ink-soft">
                  <li>Molette / ↑ ↓ : coupe précédente / suivante</li>
                  <li>Page ↑ / ↓ : 10 coupes</li>
                  <li>Ctrl + molette, clic droit glissé : zoom</li>
                  <li>Clic molette glissé : déplacer</li>
                  <li>Double-clic : recadrer</li>
                  <li>r : réinitialiser · i : inverser</li>
                </ul>
              </div>
            )}
          </div>

          {n > 1 && (
            <div className="flex items-center gap-3 border-t border-paper-line bg-white px-3 py-2">
              <button className="btn-ghost p-1.5" onClick={() => step(-1)} aria-label="Coupe précédente"><ChevronUp className="h-4 w-4" /></button>
              <input type="range" min={0} max={n - 1} value={idx} className="flex-1 accent-brand-600"
                onChange={(e) => setPos((p) => ({ ...p, [s.id]: Number(e.target.value) }))} />
              <button className="btn-ghost p-1.5" onClick={() => step(1)} aria-label="Coupe suivante"><ChevronDown className="h-4 w-4" /></button>
              <span className="mono w-16 text-right text-ink-mute">{idx + 1}/{n}</span>
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ onBack, backLabel, title, subtitle, toolbar, children }) {
  return (
    <div className="flex h-[100dvh] flex-col bg-paper">
      <header className="flex flex-wrap items-center gap-2 border-b border-paper-line bg-white px-3 py-2">
        <button className="btn-ghost px-2 py-1.5 text-sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">{backLabel}</span>
        </button>
        {title && (
          <div className="mr-auto min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            {subtitle && <p className="truncate text-xs text-ink-mute">{subtitle}</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">{toolbar}</div>
      </header>
      {children}
    </div>
  );
}

function IconBtn({ icon: Icon, title, onClick, active }) {
  return (
    <button title={title} aria-label={title} onClick={onClick}
      className={`rounded-lg border p-1.5 ${active ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-paper-line bg-white text-ink-soft hover:border-ink-mute/40'}`}>
      <Icon className="h-4 w-4" />
    </button>
  );
}
