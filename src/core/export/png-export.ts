/**
 * Print-DPI PNG export for composer sheets.
 *
 * Sheets are SVG (vector), but users routinely need a raster deliverable —
 * for report embedding, slide decks, WhatsApp-borne review committees, and
 * printing pipelines without an SVG-aware RIP. This module rasterises a
 * rendered sheet at print DPI (default 300) via an offscreen canvas.
 *
 * The critical quality step: an SVG rasterised through an <img> element
 * cannot see the page's web fonts, so all text would silently fall back to
 * generic faces. We therefore fetch the exact IBM Plex @font-face rules the
 * app loads, inline the woff2 files as base64 data URIs into a <style> block
 * inside the SVG clone, and only then rasterise. If the network is down the
 * export still proceeds with system fallbacks — disclosed to the caller.
 */

const FONT_CSS_URL =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap";

let fontCssPromise: Promise<string> | null = null;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

/**
 * Fetch the app's font CSS and inline every woff2 as a data URI. Cached for
 * the session; resolves to "" when offline (export continues with fallbacks).
 */
export function inlineFontCss(): Promise<string> {
  if (!fontCssPromise) {
    fontCssPromise = (async () => {
      try {
        const css = await (await fetch(FONT_CSS_URL)).text();
        const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
        const pairs = await Promise.all(
          urls.map(async (u) => {
            const buf = await (await fetch(u)).arrayBuffer();
            return [u, `data:font/woff2;base64,${arrayBufferToBase64(buf)}`] as const;
          }),
        );
        let out = css;
        for (const [u, data] of pairs) out = out.split(u).join(data);
        return out;
      } catch {
        return "";
      }
    })();
  }
  return fontCssPromise;
}

export interface PngExportOptions {
  /** Raster DPI (default 300). 96 = screen, 150 = draft, 300 = print. */
  dpi?: number;
  /** Background fill; statutory sheets are white. */
  background?: string;
}

/**
 * Rasterise a rendered sheet SVG to a PNG blob at the requested DPI.
 * Fonts are embedded when reachable so type renders as IBM Plex, not as a
 * generic fallback face.
 */
export async function svgToPngBlob(
  svg: string,
  widthPx: number,
  heightPx: number,
  options: PngExportOptions = {},
): Promise<Blob> {
  const dpi = options.dpi ?? 300;
  const scale = dpi / 96;

  const css = await inlineFontCss();
  let s = svg.replace(
    /font-family="monospace"/g,
    `font-family="'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace"`,
  );
  if (css) {
    s = s.replace(/<svg([^>]*)>/, `<svg$1><defs><style>${css}</style></defs>`);
  }

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("sheet SVG could not be decoded for rasterisation"));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthPx * scale);
  canvas.height = Math.round(heightPx * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D context unavailable");
  ctx.fillStyle = options.background ?? "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      "image/png",
    ),
  );
}

/** Convenience: rasterise + trigger a download with a print-DPI filename. */
export async function downloadSheetPng(
  svg: string,
  widthPx: number,
  heightPx: number,
  filename: string,
  options: PngExportOptions = {},
): Promise<void> {
  const blob = await svgToPngBlob(svg, widthPx, heightPx, options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
