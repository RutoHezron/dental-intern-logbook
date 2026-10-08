import { useEffect } from 'react';
import { useAppData } from './AppData';

/** Apply the theme preference: system (default), light or dark. */
export function ThemeSync() {
  const { state } = useAppData();
  const theme = state?.preferences.theme ?? 'system';
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);
  return null;
}
