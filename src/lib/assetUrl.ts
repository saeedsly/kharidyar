/**
 * Resolves static public asset URLs cleanly across ALL deployment environments:
 * - Root domain / Arena preview (`https://3000-.../`)
 * - Standalone Cloud CDN App (`<base href="https://.../web-cdn/">`)
 * - Subpath public hosting (`https://saeedsly.github.io/kharidyar/`)
 * - Native Android APK Capacitor WebView (`https://localhost/`)
 */
export function assetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  if (typeof window !== 'undefined' && window.document?.baseURI) {
    return new URL(clean, window.document.baseURI).href;
  }
  return `./${clean}`;
}
