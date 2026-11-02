import { type Colors, NEW_STYLES, STYLES, type Style } from "../stamp";

// What the press draws from: which style set, and which colors it prints in. Kept in localStorage, so it
// lasts between visits on one device. Share links don't depend on it: a link names its source outright.
export type Settings = { styles: "classic" | "new"; colors: Colors };

const KEY = "stamp-press:settings";

// The new set is the default once it has styles. Colors default to Wada's.
export function defaultSettings(newStyles = NEW_STYLES): Settings {
  return { styles: newStyles.length > 0 ? "new" : "classic", colors: "wada" };
}

// Reads stored settings, falling back to the default for anything missing or unknown. An empty new set
// presses the classic one instead.
export function parseSettings(
  text: string | null,
  newStyles = NEW_STYLES,
): Settings {
  const fallback = defaultSettings(newStyles);
  let stored: Partial<Record<keyof Settings, unknown>> = {};
  try {
    stored = (text && JSON.parse(text)) || {};
  } catch {
    // Unreadable: start over from the default.
  }
  const styles =
    stored.styles === "classic" ||
    (stored.styles === "new" && newStyles.length > 0)
      ? stored.styles
      : fallback.styles;
  const colors =
    stored.colors === "original" || stored.colors === "wada"
      ? stored.colors
      : fallback.colors;
  return { styles, colors };
}

export const loadSettings = () => parseSettings(localStorage.getItem(KEY));
export const saveSettings = (settings: Settings) =>
  localStorage.setItem(KEY, JSON.stringify(settings));

export const stylesFor = ({ styles }: Settings): readonly Style[] =>
  styles === "new" ? NEW_STYLES : STYLES;
