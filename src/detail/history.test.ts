import { describe, expect, it } from "vitest";
import { detailHistory } from "./history";

// A browser history to drive by hand: a list of entries' states and where we are in it.
function fakeHistory() {
  const entries: unknown[] = [null];
  let at = 0;
  const nav = {
    backs: 0,
    get state() {
      return entries[at];
    },
    pushState(state: unknown) {
      entries.splice(at + 1, Infinity, state);
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

describe("detailHistory", () => {
  it("closes on Back", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show();
    nav.back();
    expect(h.popped()).toBe(true);
  });

  it("closes through Back, so Back afterwards leaves the page as it would have before", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show();
    expect(nav.length).toBe(2);
    expect(h.close()).toBe(false);
    expect(nav.backs).toBe(1);
    expect(h.popped()).toBe(true);
    expect(nav.state).toBeNull();
  });

  it("goes back only once, however many times close is pressed before Back lands", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show();
    h.close();
    h.close();
    expect(nav.backs).toBe(1);
  });

  it("pushes one entry, however many times it's shown", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show();
    h.show();
    expect(nav.length).toBe(2);
  });

  it("drops the view's entry when Forward lands on it with none open", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show();
    h.close();
    h.popped();
    h.closed();
    nav.forward();
    expect(h.popped()).toBe(false);
    expect(nav.state).toBeNull();
    // So the next view's close goes Back to the desk, not onto the old entry.
    h.show();
    h.close();
    expect(h.popped()).toBe(true);
  });

  it("closes in place when its entry was replaced", () => {
    const nav = fakeHistory();
    const h = detailHistory(nav);
    h.show();
    nav.replaceState(null);
    expect(h.close()).toBe(true);
    expect(nav.backs).toBe(0);
  });
});
