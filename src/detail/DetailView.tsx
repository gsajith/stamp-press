import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { useGestures } from "./useGestures";
import { panBy, type Screen, UNMOVED, type View, zoomAt } from "./view";
import "./detail.css";

// How far an arrow key pans, in CSS pixels, and how much + or - zooms.
const PAN_STEP = 48;
const ZOOM_STEP = 1.25;
const KEYS: Record<string, (v: View, screen: Screen) => View> = {
  ArrowLeft: (v, s) => panBy(v, -PAN_STEP, 0, s),
  ArrowRight: (v, s) => panBy(v, PAN_STEP, 0, s),
  ArrowUp: (v, s) => panBy(v, 0, -PAN_STEP, s),
  ArrowDown: (v, s) => panBy(v, 0, PAN_STEP, s),
  "+": (v, s) => zoomAt(v, ZOOM_STEP, [0, 0], s),
  "=": (v, s) => zoomAt(v, ZOOM_STEP, [0, 0], s),
  "-": (v, s) => zoomAt(v, 1 / ZOOM_STEP, [0, 0], s),
};

// The detail view's controls, over the Canvas, where the open stamp floats (see the scene's Lifted). The whole
// screen takes the drag and pinch, and a close control sits in the corner. Focus moves to the close control,
// and Esc closes too. The arrow keys pan and + and - zoom, for the keyboard. Each open starts unpanned and
// unzoomed.
export function DetailView({
  id,
  view,
  onClose,
}: {
  id: number;
  view: RefObject<View>;
  onClose: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    view.current = UNMOVED;
  }, [view]);
  useGestures(surface, view);
  useEffect(() => close.current?.focus(), []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const move = KEYS[e.key];
      if (!move || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      view.current = move(view.current, {
        width: innerWidth,
        height: innerHeight,
      });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, view]);

  return (
    <div
      className="detail"
      role="dialog"
      aria-modal="true"
      aria-label={`Stamp ${id + 1}`}
    >
      <div ref={surface} className="detail__surface" />
      <button
        ref={close}
        type="button"
        className="detail__close"
        aria-label="Close"
        onClick={onClose}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" />
        </svg>
      </button>
    </div>
  );
}
