import { useCallback, useEffect, useRef, useState } from "react";
import Scene, { type DeskStamp } from "./scene/Scene";
import { CURRENT_SOURCE, randomSeed, resolveStamp } from "./stamp";
import "./App.css";

// Drops land around one spot for now, scattered a little so they overlap like mail.
const SCATTER = 0.25;

function newStamp(id: number): DeskStamp {
  const stamp = resolveStamp({ source: CURRENT_SOURCE, seed: randomSeed() })!;
  const r = Math.random;
  return {
    id,
    stamp,
    drop: {
      spot: [(r() * 2 - 1) * SCATTER, (r() * 2 - 1) * SCATTER],
      yaw: (r() * 2 - 1) * 0.35,
      flutter: [r() * 6.3, r() * 6.3, 2.2 + r() * 1.5, 2.8 + r() * 1.5],
    },
  };
}

export default function App() {
  // One stamp drops on first load.
  const [stamps, setStamps] = useState(() => [newStamp(0)]);
  const button = useRef<HTMLButtonElement>(null);
  const press = useCallback(
    () => setStamps((all) => [...all, newStamp(all.length)]),
    [],
  );

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
      <Scene stamps={stamps} />
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
