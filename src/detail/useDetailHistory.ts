import { useCallback, useEffect, useRef, useState } from "react";
import { linkUrl, type DeskEvent } from "../desk/desk";
import { detailHistory } from "./history";

// Keeps the desk's open stamp in step with the browser history (see detailHistory), so Back closes the detail
// view as the close control and Esc do. `link` is the open stamp's share link (deskLink), and the address
// carries it while the view is open and drops it otherwise, a share link's included once it has loaded.
// Returns the close the control and Esc call.
export function useDetailHistory(
  link: string | null,
  dispatch: (event: DeskEvent) => void,
) {
  const [steps] = useState(() => detailHistory(window.history));
  const shown = useRef(link);
  useEffect(() => {
    shown.current = link;
    if (link === null) {
      steps.closed();
      clearLink();
    } else steps.show(linkUrl(location.href, link));
  }, [link, steps]);
  useEffect(() => {
    const popped = () => {
      if (steps.popped()) dispatch({ type: "close" });
      // Back or Forward onto an entry left with a link, such as an old view's, while none is open.
      else if (shown.current === null) clearLink();
    };
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, [steps, dispatch]);
  return useCallback(() => {
    if (steps.close()) dispatch({ type: "close" });
  }, [steps, dispatch]);
}

// Takes the share link out of the current entry's address, keeping its state.
function clearLink() {
  const url = linkUrl(location.href, null);
  if (url !== location.href) history.replaceState(history.state, "", url);
}
