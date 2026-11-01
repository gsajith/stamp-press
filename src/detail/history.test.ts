import { describe, expect, it } from "vitest";
import { detailHistory } from "./history";

// A browser history to drive by hand: a list of entries' states and where we are in it.
function fakeHistory() {
  const entries: unknown[] = [null];
  const urls: (string | undefined)[] = [undefined];
  let at = 0;
  const nav = {
    backs: 0,
    get state() {
      return entries[at];
    },
    get url() {
      return urls[at];
    },
    pushState(state: unknown, _: string, url?: string) {
      entries.splice(at + 1, Infinity, state);
      urls.splice(at + 1, Infinity, url);
      at++;
    },
    replaceState(state: unknown) {
      entries[at] = state;
    },
    back() {
      nav.backs++;
      at--;
    },
    forward() {
      at++;
    },
    get length() {
      return entries.length;
    },
  };
  return nav;
}

const LINK = "https://stamp.press/?stamp=land1-1";

describe("detailHistory", () => {
  it("puts the stamp's link on the view's entry, and leaves the desk's alone", () => {
    const nav = fakeHistory();
    detailHistory(nav).show(LINK);
    expect(nav.url).toBe(LINK);
    nav.back();
    expect(nav.url).toBeUndefined();
  });

  it("closes on Back", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show(LINK);
    nav.back();
    expect(h.popped()).toBe(true);
  });

  it("closes through Back, so Back afterwards leaves the page as it would have before", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show(LINK);
    expect(nav.length).toBe(2);
    expect(h.close()).toBe(false);
    expect(nav.backs).toBe(1);
    expect(h.popped()).toBe(true);
    expect(nav.state).toBeNull();
  });

  it("goes back only once, however many times close is pressed before Back lands", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show(LINK);
    h.close();
    h.close();
    expect(nav.backs).toBe(1);
  });

  it("pushes one entry, however many times it's shown", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show(LINK);
    h.show(LINK);
    expect(nav.length).toBe(2);
  });

  it("drops the view's entry when Forward lands on it with none open", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show(LINK);
    h.close();
    h.popped();
    h.closed();
    nav.forward();
    expect(h.popped()).toBe(false);
    expect(nav.state).toBeNull();
    // So the next view's close goes Back to the desk, not onto the old entry.
    h.show(LINK);
    h.close();
    expect(h.popped()).toBe(true);
  });

  it("closes on the first try after a reload left the page on an old view's entry", () => {
    const nav = fakeHistory();
    // The page before the reload opened a view and left its entry behind.
    detailHistory(nav).show(LINK);
    const h = detailHistory(nav);
    h.show(LINK);
    expect(h.close()).toBe(false);
    expect(h.popped()).toBe(true);
  });

  it("closes in place when its entry was replaced", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show(LINK);
    nav.replaceState(null);
    expect(h.close()).toBe(true);
    expect(nav.backs).toBe(0);
  });
});
