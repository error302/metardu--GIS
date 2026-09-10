# MetaRDU PostGIS Bridge

Browsers cannot open TCP sockets to PostgreSQL, so municipal deployments run
this tiny **read-only** HTTP bridge on a host that can reach the database.
The workstation lists spatial tables, previews them, and pulls layers through
`ST_AsHexEWKB` — decoded client-side with no GDAL dependency.

## Run

```bash
cd bridge
npm install
PGURL=postgres://reader:secret@db-host:5432/gis node postgis-bridge.mjs
```

Endpoints (all JSON, CORS-enabled):

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | connectivity + server version |
| `/tables` | GET | `geometry_columns` listing |
| `/query` | POST | `{ sql, params? }` — **SELECT/WITH only** |

## Security posture

- Only single `SELECT` / `WITH` statements are forwarded; stacked queries and
  write/DDL keywords are rejected with HTTP 403.
- **The bridge is a convenience, not a security boundary.** Connect it with a
  dedicated PostgreSQL role that has `SELECT`-only grants (`ALTER ROLE reader
  NOUPDATE` / table-level `GRANT SELECT`).
- Binds `127.0.0.1` by default. Set `HOST=0.0.0.0` only behind a VPN or
  authenticated reverse proxy. `ALLOW_ORIGIN` narrows CORS beyond `*`.

## In the workstation

`Data → PostGIS Link` — enter the bridge URL (`http://localhost:8787`),
list tables, preview a layer (rows + SRID), then import. Layers whose SRID
differs from the working CRS are reprojected with proj4 during import and the
operation is disclosed in the import notes.

---

# MetaRDU Sync Relay (edge-first collaboration)

A second, independent bridge: an in-memory relay that shuffles immutable
CRDT operations between replicas of a `.metardu.json` project. It is **not**
a server product and holds no authoritative state — replicas converge
client-side (`src/core/crdt/crdt.ts`), so the offline promise always holds.
Intended for site-office LANs; put TLS/auth in front of it for WAN use.

## Run

```bash
cd bridge
node sync-bridge.mjs 8788        # zero dependencies
```

| Route | Method | Purpose |
|---|---|---|
| `/health` | GET | relay status, op count |
| `/ops?since=N` | GET | ops with seq > N |
| `/ops` | POST | append a `METARDU_CHANGES` envelope (dedup by op id) |

Guards: 20 MB payload cap, 500k-op cap, envelope + per-op validation,
CORS. Restarts start from an empty log (memory-only by design).

**Workstation:** `Data → Edge Sync` — export/merge `.metardu-changes.json`
change files, or Pull/Push through the relay URL.
