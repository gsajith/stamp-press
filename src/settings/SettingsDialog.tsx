import { useRef } from "react";
import { NEW_STYLES, STYLES } from "../stamp";
import type { Settings } from "./settings";
import "./settings.css";

// A gear in the corner of the desk that opens the press's settings in a modal dialog. The browser's dialog
// gives Esc, focus trapping and an inert desk behind it. Changes apply to the next press.
export function SettingsDialog({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const set = (change: Partial<Settings>) =>
    onChange({ ...settings, ...change });

  return (
    <>
      <button
        type="button"
        className="settings__open"
        aria-label="Settings"
        onClick={() => dialog.current?.showModal()}
      >
        {/* Lucide's "settings" gear (ISC license, lucide.dev). */}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      <dialog
        ref={dialog}
        className="settings"
        aria-labelledby="settings-title"
        // A click on the backdrop lands on the dialog itself, outside its form.
        onClick={(e) => e.target === dialog.current && dialog.current.close()}
      >
        <form method="dialog">
          <h2 id="settings-title">Settings</h2>
          <fieldset>
            <legend>Styles</legend>
            <label>
              <input
                type="radio"
                name="styles"
                checked={settings.styles === "classic"}
                onChange={() => set({ styles: "classic" })}
              />
              Classic <span>{STYLES.length}</span>
            </label>
            <label>
              <input
                type="radio"
                name="styles"
                checked={settings.styles === "new"}
                disabled={NEW_STYLES.length === 0}
                onChange={() => set({ styles: "new" })}
              />
              New <span>{NEW_STYLES.length}</span>
            </label>
          </fieldset>
          <fieldset>
            <legend>Colors</legend>
            <label>
              <input
                type="radio"
                name="colors"
                checked={settings.colors === "original"}
                onChange={() => set({ colors: "original" })}
              />
              Original
            </label>
            <label>
              <input
                type="radio"
                name="colors"
                checked={settings.colors === "wada"}
                onChange={() => set({ colors: "wada" })}
              />
              Sanzo Wada
            </label>
          </fieldset>
          <button type="submit" className="settings__done">
            Done
          </button>
        </form>
      </dialog>
    </>
  );
}
