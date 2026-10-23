export type Theme = 'dark' | 'light';

export const THEME_KEY = 'lazylab_theme';
/** Key used before the project was renamed from labwi; read once and moved to THEME_KEY. */
export const LEGACY_THEME_KEY = 'labwi_theme';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const isTheme = (v: string | null): v is Theme => v === 'dark' || v === 'light';

/** Reads the saved theme, moving a value saved under the legacy key to the current one. */
export function readStoredTheme(storage: ThemeStorage = localStorage): Theme {
  try {
    const current = storage.getItem(THEME_KEY);
    if (isTheme(current)) return current;
    const legacy = storage.getItem(LEGACY_THEME_KEY);
    if (isTheme(legacy)) {
      storage.setItem(THEME_KEY, legacy);
      storage.removeItem(LEGACY_THEME_KEY);
      return legacy;
    }
  } catch {
    // Storage blocked (private mode, sandboxed frame): fall back to the default.
  }
  return 'dark';
}

export function storeTheme(theme: Theme, storage: ThemeStorage = localStorage) {
  try {
    storage.setItem(THEME_KEY, theme);
  } catch {}
}
