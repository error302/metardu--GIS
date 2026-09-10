#!/usr/bin/env node
/**
 * MetaRDU PostGIS bridge — a tiny READ-ONLY HTTP proxy that lets the
 * browser-based GIS workstation query a PostGIS server it cannot reach
 * directly (browsers cannot open TCP sockets to PostgreSQL:5432).
 *
 *   GET  /health  → { ok: true, database, server version }
 *   GET  /tables  → geometry_columns listing
 *   POST /query   → { sql, params? } — SELECT/WITH statements only
 *
 * Run on the machine that can reach Postgres:
 *   npm install pg
 *   PGURL=postgres://user:pass@host:5432/db node postgis-bridge.mjs
 *
 * Security posture (read-mostly sync, municipal deployments):
 *   - Only SELECT / WITH statements are forwarded; everything else 403.
 *   - Multiple statements are rejected (no stacked queries).
 *   - Run it against a dedicated read-only Postgres role. The bridge is a
 *     convenience, not a security boundary — the database role is.
 *   - Binds 127.0.0.1 by default; set HOST=0.0.0.0 only behind a VPN.
 */

import http from "node:http";
import pg from "pg";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const PGURL = process.env.PGURL ?? process.env.DATABASE_URL ?? "";

if (!PGURL) {
  console.error("postgis-bridge: set PGURL=postgres://user:pass@host:5432/db");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: PGURL, max: 4, idleTimeoutMillis: 30000 });

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOW_ORIGIN ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, payload) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

/** Read-only enforcement: single SELECT/WITH statement, no semicolons tail. */
function assertReadOnly(sql) {
  const s = String(sql ?? "").trim();
  if (!s) throw forbidden("empty SQL");
  if (s.includes(";")) {
    // allow exactly one trailing semicolon, nothing stacked
    const trimmed = s.replace(/;\s*$/, "");
    if (trimmed.includes(";")) throw forbidden("multiple statements are not allowed");
    return assertReadOnly(trimmed);
  }
  if (!/^(select|with)\b/i.test(s)) throw forbidden("only SELECT / WITH statements are allowed (read-only bridge)");
  // Keyword scan — a read-only role would also enforce this server-side.
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|do)\b/i.test(s.replace(/\b(select|with|as|from|where|and|or|not|in|is|st_[a-z_0-9]+)\b/gi, ""))) {
    throw forbidden("statement contains write/DDL keywords");
  }
  return s;
}

function forbidden(msg) {
  const err = new Error(msg);
  err.status = 403;
  return err;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }

  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (url.pathname === "/health" && req.method === "GET") {
      const { rows } = await pool.query("SELECT version() AS v, current_database() AS db");
      return json(res, 200, { ok: true, database: rows[0].db, version: rows[0].v.split(" ").slice(0, 2).join(" ") });
    }

    if (url.pathname === "/tables" && req.method === "GET") {
      const { rows } = await pool.query(
        `SELECT f_table_name, f_geometry_column, srid, type
         FROM geometry_columns ORDER BY f_table_name, f_geometry_column`,
      );
      return json(res, 200, rows);
    }

    if (url.pathname === "/query" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body || "{}");
      const sql = assertReadOnly(parsed.sql);
      const params = Array.isArray(parsed.params) ? parsed.params : [];
      const started = Date.now();
      const result = await pool.query(sql, params);
      return json(res, 200, {
        columns: result.fields.map((f) => f.name),
        rows: result.rows,
        rowCount: result.rowCount,
        ms: Date.now() - started,
      });
    }

    return json(res, 404, { error: "not found" });
  } catch (err) {
    const status = err?.status ?? 500;
    return json(res, status, { error: String(err?.message ?? err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`postgis-bridge listening on http://${HOST}:${PORT} (read-only)`);
});

async function shutdown() {
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
