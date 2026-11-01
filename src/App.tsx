import { useCallback, useEffect, useReducer, useRef } from "react";
import { deskReducer, EMPTY_DESK } from "./desk/desk";
import { visibleArea } from "./scene/camera";
import Scene from "./scene/Scene";
import { pressStampRef } from "./stamp";
import "./App.css";

export default function App() {
  // One stamp flings out of the press on first load.
  const [desk, dispatch] = useReducer(deskReducer, EMPTY_DESK, (empty) =>
    deskReducer(empty, { type: "load", ref: pressStampRef() }),
  );
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

  // Space and Enter press the button from anywhere. On the button itself, its own click handles them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target === button.current) return;
      e.preventDefault();
      press();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  return (
    <main>
      <Scene desk={desk} press={button} onLand={land} />
      <button
        ref={button}
        className="press"
        type="button"
        onClick={press}
        aria-keyshortcuts="Space Enter"
      >
        Generate a stamp
      </button>
    </main>
  );
}
