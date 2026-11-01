import { type RefObject, useEffect } from "react";
import { panBy, type View, zoomAt } from "./view";

// Safari's trackpad pinch, which it sends instead of ctrl+wheel. Not in TypeScript's DOM types.
type GestureEvent = Event & { scale: number; clientX: number; clientY: number };

// How much a wheel's pixel of travel zooms: a trackpad pinch arrives as ctrl+wheel in small steps, a mouse
// wheel in large ones.
const WHEEL = { pinch: 0.01, scroll: 0.002 };
// A wheel in lines rather than pixels moves about this many pixels a line.
const LINE = 16;

// Ported from the blind box. Gestures on the detail view's surface, `el`, which covers the screen: a drag pans
// the stamp, and a pinch, wheel or trackpad pinch zooms it about the fingers or the cursor. They write into
// `view`, which the lifted stamp reads every frame.
export function useGestures(
  el: RefObject<HTMLElement | null>,
  view: RefObject<View>,
) {
  useEffect(() => {
    const surface = el.current;
    if (!surface) return;
    const screen = () => ({ width: innerWidth, height: innerHeight });
    // From the screen's center, as the view measures.
    const at = (x: number, y: number): [number, number] => [
      x - innerWidth / 2,
      y - innerHeight / 2,
    ];
    const pointers = new Map<number, { x: number; y: number }>();
    // Where the fingers' middle and spread were last, so each move pans and zooms by the change.
    let last = { x: 0, y: 0, spread: 1 };
    let pinchFrom = 1;

    const grip = () => {
      let [x, y] = [0, 0];
      for (const p of pointers.values()) {
        x += p.x / pointers.size;
        y += p.y / pointers.size;
      }
      const [a, b] = pointers.values();
      return { x, y, spread: b ? Math.hypot(a.x - b.x, a.y - b.y) : 1 };
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      surface.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = grip();
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      [p.x, p.y] = [e.clientX, e.clientY];
      const now = grip();
      let v = panBy(view.current, now.x - last.x, now.y - last.y, screen());
      if (pointers.size >= 2)
        v = zoomAt(v, now.spread / last.spread, at(now.x, now.y), screen());
      view.current = v;
      last = now;
    };
    const up = (e: PointerEvent) => {
      if (pointers.delete(e.pointerId)) last = grip();
    };
    const roll = (e: WheelEvent) => {
      // Keeps the browser from zooming the page on a trackpad pinch.
      e.preventDefault();
      const px = e.deltaMode === 1 ? LINE : 1;
      const rate = e.ctrlKey ? WHEEL.pinch : WHEEL.scroll;
      const factor = Math.exp(-e.deltaY * px * rate);
      view.current = zoomAt(
        view.current,
        factor,
        at(e.clientX, e.clientY),
        screen(),
      );
    };
    const gesture = (e: Event) => {
      e.preventDefault();
      // On touch, Safari sends these alongside the pointers, which already pinch.
      if (pointers.size) return;
      const { scale, clientX, clientY } = e as GestureEvent;
      if (e.type === "gesturestart") pinchFrom = 1;
      view.current = zoomAt(
        view.current,
        scale / pinchFrom,
        at(clientX, clientY),
        screen(),
      );
      pinchFrom = scale;
    };

    const gestures = ["gesturestart", "gesturechange", "gestureend"];
    surface.addEventListener("pointerdown", down);
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerup", up);
    surface.addEventListener("pointercancel", up);
    surface.addEventListener("wheel", roll, { passive: false });
    for (const type of gestures) surface.addEventListener(type, gesture);
    return () => {
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", up);
      surface.removeEventListener("pointercancel", up);
      surface.removeEventListener("wheel", roll);
      for (const type of gestures) surface.removeEventListener(type, gesture);
    };
  }, [el, view]);
}
