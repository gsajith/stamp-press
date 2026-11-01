// The browser history, as much of it as the detail view uses.
type Nav = {
  readonly state: unknown;
  pushState(state: unknown, unused: string): void;
  replaceState(state: unknown, unused: string): void;
  back(): void;
};

// The state on the history entry an open detail view adds.
const ENTRY = { detail: true };
const isEntry = (state: unknown) =>
  (state as { detail?: unknown } | null)?.detail === true;

// Ported from the blind box. Keeps the detail view and the browser history in step, so the browser's Back
// closes the view. Opening pushes an entry, and closing goes Back past it, so the desk's own entry is
// where Back starts from again. The address stays as it is.
export function detailHistory(nav: Nav) {
  let open = false;
  let closing = false;

  return {
    // Adds the open view's entry, unless one is already open.
    show() {
      if (open) return;
      nav.pushState(ENTRY, "");
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
