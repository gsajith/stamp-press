// The browser history, as much of it as the detail view uses.
type Nav = {
  readonly state: unknown;
  pushState(state: unknown, unused: string, url: string): void;
  replaceState(state: unknown, unused: string): void;
  back(): void;
};

// Ported from the blind box. Keeps the detail view and the browser history in step, so the browser's Back
// closes the view. Opening pushes an entry at the stamp's share link, and closing goes Back past it, so the
// desk's own entry, and its address, is where Back starts from again.
export function detailHistory(nav: Nav) {
  let open = false;
  let closing = false;
  // The state on the entries this page adds. Its token tells them from an earlier page load's, which a reload
  // leaves in the history: those are just more desk entries.
  const entry = { detail: Math.random() };
  const isEntry = (state: unknown) =>
    (state as { detail?: unknown } | null)?.detail === entry.detail;

  return {
    // Adds the open view's entry at `url`, unless one is already open.
    show(url: string) {
      if (open) return;
      nav.pushState(entry, "", url);
      open = true;
      closing = false;
    },
    // Asks to close. Returns whether to close now, rather than once Back lands (popped). Only goes Back once:
    // a second press before Back lands would go Back again, off the page.
    close(): boolean {
      if (!open || closing) return false;
      closing = true;
      if (isEntry(nav.state)) {
        nav.back();
        return false;
      }
      return true;
    },
    // After Back or Forward: whether the open view should close. Forward onto an old view's entry, with none
    // open, puts the desk's state back on it.
    popped(): boolean {
      if (!isEntry(nav.state)) return open;
      if (!open) nav.replaceState(null, "");
      return false;
    },
    // Once the desk has closed the view.
    closed() {
      open = false;
      closing = false;
    },
  };
}
