import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconBack, IconChevron, IconClose, IconExpand, IconZoomIn, IconZoomOut } from './Icons';

/** YouTube / Vimeo links → their embed URL; null for a plain video file. */
export const embed = (url) => {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
};

const MIN = 1;
const MAX = 5;
const STEP = 1.5; // each zoom button press / wheel notch multiplies or divides the scale by this much
const FIT = { s: 1, x: 0, y: 0 };

// Full-screen photo viewer with zoom: + / − buttons and keys, mouse wheel, double-click or double-tap,
// pinch on touch screens, and drag to move around a zoomed photo. Swipe or the arrows change photo.
export default function Lightbox({ items, index, name, onIndex, onClose }) {
  const [view, setView] = useState(FIT);
  const stage = useRef(null);
  const closeRef = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const lastTap = useRef(null);
  const cur = items[index];
  const photo = cur && cur.kind !== 'video';
  const many = items.length > 1;

  const go = useCallback((d) => onIndex((index + d + items.length) % items.length), [index, items.length, onIndex]);
  useEffect(() => setView(FIT), [index]);

  // Keep a zoomed photo covering the screen: it can't be dragged further than its own edges.
  const clamp = ({ s, x, y }) => {
    const r = stage.current?.getBoundingClientRect();
    if (!r || s <= MIN) return FIT;
    const mx = (r.width * (s - 1)) / 2;
    const my = (r.height * (s - 1)) / 2;
    return { s, x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };
  // Point on screen → offset from the middle of the stage, so zooming keeps that point under the finger / cursor.
  const toStage = (cx, cy) => {
    const r = stage.current.getBoundingClientRect();
    return [cx - (r.left + r.width / 2), cy - (r.top + r.height / 2)];
  };
  const zoomFrom = (from, s, px = 0, py = 0) => {
    const ns = Math.min(MAX, Math.max(MIN, s));
    const k = ns / from.s;
    return clamp({ s: ns, x: px - (px - from.x) * k, y: py - (py - from.y) * k });
  };
  const zoomBy = useCallback((f, px, py) => setView((v) => zoomFrom(v, v.s * f, px, py)), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    const on = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && many) go(1);
      else if (e.key === 'ArrowLeft' && many) go(-1);
      else if (!photo) return;
      else if (e.key === '+' || e.key === '=') zoomBy(STEP);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / STEP);
      else if (e.key === '0') setView(FIT);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [go, many, onClose, photo, zoomBy]);

  // The wheel listener has to be non-passive to stop the page behind from scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!el || !photo) return undefined;
    const on = (e) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, ...toStage(e.clientX, e.clientY));
    };
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, [photo, zoomBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: toStage((a.x + b.x) / 2, (a.y + b.y) / 2), from: view };
    } else if (pts.length === 1) {
      gesture.current = { type: view.s > MIN ? 'pan' : 'swipe', sx: pts[0].x, sy: pts[0].y, t: Date.now(), from: view };
    } else gesture.current = null;
  };

  const onPointerDown = (e) => {
    if (!photo || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      const [px, py] = g.mid;
      setView(zoomFrom(g.from, (g.from.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist, px, py));
    } else if (g.type === 'pan') {
      setView(clamp({ s: g.from.s, x: g.from.x + e.clientX - g.sx, y: g.from.y + e.clientY - g.sy }));
    }
  };

  const onPointerUp = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    const dx = e.clientX - (g?.sx ?? e.clientX);
    const dy = e.clientY - (g?.sy ?? e.clientY);
    const tap = g && g.type !== 'pinch' && Math.hypot(dx, dy) < 10 && Date.now() - g.t < 300;
    if (g?.type === 'swipe' && many && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (tap) {
      // Double-tap / double-click: zoom in on that spot, or back out to the whole photo.
      const prev = lastTap.current;
      if (prev && Date.now() - prev.t < 320 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
        lastTap.current = null;
        setView((v) => (v.s > MIN ? FIT : zoomFrom(v, 2.5, ...toStage(e.clientX, e.clientY))));
      } else lastTap.current = { t: Date.now(), x: e.clientX, y: e.clientY };
    }
    startGesture(); // lifting one finger of a pinch carries on as a drag with the other
  };

  const pct = Math.round(view.s * 100);
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${name} photos`}>
      <div className="lb-bar">
        {many ? <span className="lb-count">{index + 1} / {items.length}</span> : <span />}
        <div className="lb-tools">
          {photo && <>
            <button type="button" className="lb-btn" onClick={() => zoomBy(1 / STEP)} disabled={view.s <= MIN} aria-label="Zoom out" title="Zoom out (−)"><IconZoomOut size={20} /></button>
            <span className="lb-pct" aria-live="polite">{pct}%</span>
            <button type="button" className="lb-btn" onClick={() => zoomBy(STEP)} disabled={view.s >= MAX} aria-label="Zoom in" title="Zoom in (+)"><IconZoomIn size={20} /></button>
            <button type="button" className="lb-btn" onClick={() => setView(FIT)} disabled={view.s <= MIN} aria-label="Fit to screen" title="Fit to screen (0)"><IconExpand size={18} /></button>
          </>}
          <button type="button" ref={closeRef} className="lb-btn" onClick={onClose} aria-label="Close" title="Close (Esc)"><IconClose size={22} /></button>
        </div>
      </div>
      <div ref={stage} className={`lb-stage ${view.s > MIN ? 'zoomed' : ''}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onClick={(e) => { if (e.target === e.currentTarget && view.s <= MIN && !photo) onClose(); }}>
        {photo
          ? <img key={cur.id} src={cur.url} alt={cur.alt || name} draggable={false}
            style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`, transition: gesture.current ? 'none' : undefined }} />
          : cur && (embed(cur.url)
            ? <iframe key={cur.id} src={embed(cur.url)} title={cur.alt || `${name} video`} allow="encrypted-media; picture-in-picture" allowFullScreen />
            : <video key={cur.id} src={cur.url} poster={cur.posterUrl || undefined} controls playsInline aria-label={cur.alt || `${name} video`} />)}
      </div>
      {many && <>
        <button type="button" className="lb-btn lb-nav prev" onClick={() => go(-1)} aria-label="Previous photo"><IconBack size={22} /></button>
        <button type="button" className="lb-btn lb-nav next" onClick={() => go(1)} aria-label="Next photo"><IconChevron size={22} /></button>
      </>}
      {photo && view.s <= MIN && <p className="lb-hint">Double-tap, pinch or scroll to zoom</p>}
    </div>,
    document.body,
  );
}
