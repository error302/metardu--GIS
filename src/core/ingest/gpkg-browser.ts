/**
 * Browser-side sql.js loader for GeoPackage ingest AND export.
 *
 * Kept out of `ingest/index.ts` so node/test bundles never see Vite's
 * `?url` asset imports. The dynamic imports keep sql.js (~1 MB JS + wasm)
 * in its own lazy chunk that is only fetched when a .gpkg is imported or
 * exported.
 */

import { configureSqlLoader, SqlInitOptions, SqlJsStatic } from "./gpkg";

let configured = false;

export async function ensureGpkgBrowserLoader(): Promise<void> {
  if (configured) return;
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import("sql.js"),
    import("sql.js/dist/sql-wasm.wasm?url"),
  ]);
  // The official sql.js typings omit Database.export() though the runtime
  // object provides it (the GeoPackage writer relies on it) — one honest
  // cast at this boundary instead of leaking casts everywhere.
  const loader = (opts?: SqlInitOptions): Promise<SqlJsStatic> =>
    initSqlJs({ locateFile: () => wasmUrl, ...opts }) as unknown as Promise<SqlJsStatic>;
  configureSqlLoader(loader);
  configured = true;
}
