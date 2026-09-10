/**
 * Ambient declarations for sql.js — the npm package ships no bundled types,
 * and Vite's `?url` asset imports need a module declaration.
 */

declare module "sql.js" {
  export interface SqlJsDatabase {
    exec: (
      sql: string,
      params?: unknown[],
    ) => { columns: string[]; values: unknown[][] }[];
    close: () => void;
  }
  export interface SqlJsConfig {
    locateFile?: (file: string, prefix?: string) => string;
    wasmBinary?: ArrayBuffer | Uint8Array | Buffer;
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | Buffer) => SqlJsDatabase;
  }
  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}

declare module "sql.js/dist/sql-wasm.wasm?url" {
  const url: string;
  export default url;
}
