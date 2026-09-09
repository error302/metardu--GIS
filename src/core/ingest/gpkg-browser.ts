/**
 * Browser-side sql.js loader for GeoPackage ingestion.
 *
 * Kept out of `ingest/index.ts` so node/test bundles never see Vite's
 * `?url` asset imports. The dynamic imports keep sql.js (~1 MB JS + wasm)
 * in its own lazy chunk that is only fetched when a .gpkg is imported.
 */

import { configureSqlLoader } from "./gpkg";

let configured = false;

export async function ensureGpkgBrowserLoader(): Promise<void> {
  if (configured) return;
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import("sql.js"),
    import("sql.js/dist/sql-wasm.wasm?url"),
  ]);
  configureSqlLoader((opts) =>
    initSqlJs({ locateFile: () => wasmUrl, ...opts }),
  );
  configured = true;
}
