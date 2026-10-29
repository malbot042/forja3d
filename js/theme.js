// Tema claro / oscuro. Por defecto sigue al sistema; al elegir uno se recuerda en este navegador.
const KEY = 'forja3d:theme';
const media = window.matchMedia('(prefers-color-scheme: light)');

export function storedTheme() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* sin almacenamiento */ }
  apply(theme);
}

export function toggleTheme() {
  setTheme(currentTheme() === 'light' ? 'dark' : 'light');
  return currentTheme();
}

/** Lee una variable CSS del tema actual. */
export const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Si el usuario no ha elegido, seguir los cambios del sistema
media.addEventListener('change', () => { if (!storedTheme()) apply(media.matches ? 'light' : 'dark'); });
