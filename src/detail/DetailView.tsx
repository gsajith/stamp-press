import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Credit } from "../stamp";
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

// How long the copy-link control shows how the copy went, in milliseconds.
const COPIED_TIME = 1600;

// The detail view's controls, over the Canvas, where the open stamp floats (see the scene's Lifted). The whole
// screen takes the drag and pinch, a close control sits in the corner, and a copy-link control copies `link`,
// the stamp's share link, where the desk's press button was. Focus moves to the close control,
// and Esc closes too. The arrow keys pan and + and - zoom, for the keyboard. Each open starts unpanned and
// unzoomed. `credits` names the open-source projects a ported style comes from, in the top left corner.
export function DetailView({
  id,
  link,
  credits,
  view,
  onClose,
}: {
  id: number;
  link: string;
  credits: readonly Credit[];
  view: RefObject<View>;
  onClose: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), COPIED_TIME);
    return () => clearTimeout(timer);
  }, [copied]);
  // The clipboard is missing outside a secure context, which throws here, and the copy can be refused.
  const copy = () =>
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(link))
      .then(() => setCopied("copied"))
      .catch(() => setCopied("failed"));
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
      {credits.length > 0 && (
        <ul className="detail__credits" aria-label="Generator">
          {credits.map((c) => (
            <li key={c.url}>
              <a href={c.url} target="_blank" rel="noreferrer">
                {c.url.startsWith("https://github.com/") && <GitHubMark />}
                {c.project}
              </a>{" "}
              by {c.author}
            </li>
          ))}
        </ul>
      )}
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
      <button
        type="button"
        className="detail__copy"
        aria-live="polite"
        onClick={copy}
      >
        {copied === "copied"
          ? "Link copied"
          : copied === "failed"
            ? "Couldn't copy"
            : "Copy link"}
      </button>
    </div>
  );
}

// GitHub's mark, before a project link that goes to GitHub.
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-label="GitHub:" role="img">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
