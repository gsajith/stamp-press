import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { useGestures } from "./useGestures";
import { UNMOVED, type View } from "./view";
import "./detail.css";

// The detail view's controls, over the Canvas, where the open stamp floats (see the scene's Lifted). The whole
// screen takes the drag and pinch, and a close control sits in the corner. Focus moves to the close control,
// and Esc closes too. Each open starts unpanned and unzoomed.
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

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
