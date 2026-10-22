/**
 * Resolves static public asset URLs cleanly across ALL deployment environments:
 * - Root domain / Arena preview (`https://3000-.../`)
 * - Subpath public hosting (`https://saeedsly.github.io/kharidyar/`)
 * - Native Android APK Capacitor WebView (`https://localhost/`)
 */
export function assetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  const base = import.meta.env.BASE_URL || './';
  if (typeof window !== 'undefined' && window.document?.baseURI) {
    return new URL(`${base}${clean}`.replace(/\/{2,}/g, '/'), window.location.href).href;
  }
  return `./${clean}`;
}
