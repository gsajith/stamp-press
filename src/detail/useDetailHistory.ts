import { useCallback, useEffect, useState } from "react";
import type { DeskEvent } from "../desk/desk";
import { detailHistory } from "./history";

// Keeps the desk's open stamp in step with the browser history (see detailHistory), so Back closes the detail
// view as the close control and Esc do. Returns the close those two call.
export function useDetailHistory(
  open: number | null,
  dispatch: (event: DeskEvent) => void,
) {
  const [steps] = useState(() => detailHistory(window.history));
  useEffect(() => {
    if (open === null) steps.closed();
    else steps.show();
  }, [open, steps]);
  useEffect(() => {
    const popped = () => {
      if (steps.popped()) dispatch({ type: "close" });
    };
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, [steps, dispatch]);
  return useCallback(() => {
    if (steps.close()) dispatch({ type: "close" });
  }, [steps, dispatch]);
}
