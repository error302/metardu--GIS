#!/usr/bin/env node
/**
 * MetaRDU Sync Relay (Phase D — edge-first collaboration).
 *
 * A tiny in-memory operation-log relay for offline-first teams. It is NOT a
 * server product: replicas hold authoritative state and converge client-side
 * via the CRDT in src/core/crdt/crdt.ts. The relay only shuffles immutable,
 * already-signed CRDT ops between machines on the same network.
 *
 * Endpoints:
 *   GET  /health          → { ok, head, ops }
 *   GET  /ops?since=N     → { head, ops }   (ops with seq > N)
 *   POST /ops             → { accepted, ignored }   body: METARDU_CHANGES envelope
 *
 * Guarantees: op identity (id) makes delivery idempotent; payloads are
 * validated and size-capped; nothing is persisted (restart = empty log).
 *
 * Usage:  node sync-bridge.mjs [port]     (default 8788)
 */

import { createServer } from "node:http";

const PORT = Number(process.argv[2] || process.env.PORT || 8788);
const MAX_BODY = 20 * 1024 * 1024; // 20 MB — generous for 50k-point ops logs
const MAX_OPS = 500_000;

/** The log: entries {seq, op}. Deduplicated by op.id. */
const log = [];
const index = new Map(); // op.id -> entry

function send(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

function isValidOp(op) {
  return (
    op && typeof op === "object" &&
    typeof op.op === "string" &&
    typeof op.id === "string" && op.id.length < 200 &&
    typeof op.replica === "string" && op.replica.length < 200 &&
    typeof op.lamport === "number" && Number.isFinite(op.lamport) &&
    typeof op.ts === "string"
  );
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true, head: log.length, ops: log.length, relay: "metardu-sync-bridge 1.0.0" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/ops") {
    const since = Number(url.searchParams.get("since") || 0);
    const ops = log.filter((e) => e.seq > since);
    send(res, 200, { head: log.length, ops });
    return;
  }

  if (req.method === "POST" && url.pathname === "/ops") {
    let raw = "";
    let size = 0;
    let tooBig = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        tooBig = true;
        send(res, 413, { error: "payload exceeds 20 MB cap" });
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      if (tooBig) return;
      try {
        const body = JSON.parse(raw);
        if (!body || body.format !== "METARDU_CHANGES" || !Array.isArray(body.ops)) {
          send(res, 400, { error: "expected a METARDU_CHANGES envelope with an ops array" });
          return;
        }
        if (body.ops.length > MAX_OPS) {
          send(res, 413, { error: `ops array exceeds ${MAX_OPS} entries` });
          return;
        }
        let accepted = 0;
        let ignored = 0;
        for (const op of body.ops) {
          if (!isValidOp(op) || index.has(op.id)) {
            ignored += 1;
            continue;
          }
          const entry = { seq: log.length + 1, op };
          log.push(entry);
          index.set(op.id, entry);
          accepted += 1;
        }
        console.log(`+${accepted} ops from replica ${body.replica ?? "?"} (head ${log.length})`);
        send(res, 200, { accepted, ignored, head: log.length });
      } catch (err) {
        send(res, 400, { error: `malformed JSON: ${err.message}` });
      }
    });
    return;
  }

  send(res, 404, { error: "not found — endpoints: GET /health, GET /ops?since=N, POST /ops" });
});

server.listen(PORT, () => {
  console.log(`MetaRDU sync relay listening on http://0.0.0.0:${PORT}`);
  console.log("In-memory only — restart clears the log. LAN use; put TLS/auth in front for WAN.");
});
