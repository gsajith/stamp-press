import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { deskReducer, EMPTY_DESK } from "./desk/desk";
import { DetailView } from "./detail/DetailView";
import { useDetailHistory } from "./detail/useDetailHistory";
import { UNMOVED, type View } from "./detail/view";
import { visibleArea } from "./scene/camera";
import Scene from "./scene/Scene";
import { pressStampRef } from "./stamp";
import "./App.css";

export default function App() {
  // One stamp flings out of the press on first load.
  const [desk, dispatch] = useReducer(deskReducer, EMPTY_DESK, (empty) =>
    deskReducer(empty, { type: "load", ref: pressStampRef() }),
  );
  // The open stamp's pan and zoom, which the detail view's gestures write and the scene reads every frame.
  const [view] = useState<{ current: View }>(() => ({ current: UNMOVED }));
  // Stamps fling out of the button, so the scene reads where it sits on screen.
  const button = useRef<HTMLButtonElement>(null);
  // The desk refuses a press while too many stamps are still in the air. The scene fills the window, so the
  // window's shape sets how much desk a burst can spread over.
  const press = useCallback(
    () =>
      dispatch({
        type: "press",
        ref: pressStampRef(),
        at: performance.now(),
        area: visibleArea(innerWidth / innerHeight),
      }),
    [],
  );
  const land = useCallback((id: number) => dispatch({ type: "land", id }), []);
  const open = useCallback((id: number) => dispatch({ type: "open", id }), []);
  const close = useDetailHistory(desk.open, dispatch);

  // Space and Enter press the button from anywhere. On a button, such as a stamp's focus ring, its own click
  // handles them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      press();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  // Closing hands a keyboard user's focus back to the stamp's ring, so Tab carries on from there. Not after a
  // tap or click: a focused ring would take Space and Enter from the button.
  const keyed = useRef(false);
  const opened = useRef<number | null>(null);
  useEffect(() => {
    const key = () => (keyed.current = true);
    const point = () => (keyed.current = false);
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", point, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", point, true);
    };
  }, []);
  useEffect(() => {
    if (desk.open !== null) {
      opened.current = desk.open;
      return;
    }
    const id = opened.current;
    opened.current = null;
    if (id === null || !keyed.current) return;
    document.querySelector<HTMLElement>(`.ring[data-stamp="${id}"]`)?.focus();
  }, [desk.open]);

  return (
    <main>
      {/* Behind the detail view, the desk and its controls are out of reach. */}
      <div className="desk" inert={desk.open !== null}>
        <Scene
          desk={desk}
          view={view}
          press={button}
          onLand={land}
          onOpen={open}
        />
        <button
          ref={button}
          className="press"
          type="button"
          onClick={press}
          aria-keyshortcuts="Space Enter"
        >
          Generate a stamp
        </button>
      </div>
      {desk.open !== null && (
        <DetailView id={desk.open} view={view} onClose={close} />
      )}
    </main>
  );
}
