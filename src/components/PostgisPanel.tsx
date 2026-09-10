/**
 * PostGIS Link — connect to a read-only bridge (bridge/postgis-bridge.mjs),
 * list spatial tables, and import a layer into the working document.
 * Read-mostly by design: the workstation never writes back from here.
 */

import React, { useState } from "react";
import { Database, RefreshCw, Download, AlertTriangle, Plug, Unplug } from "lucide-react";
import { SurveyPoint } from "../types/spatial";
import { listPgTables, fetchPgLayer, PgTableInfo } from "../core/postgis/client";

interface PostgisPanelProps {
  onImportPoints: (points: SurveyPoint[], layerName: string, srid: number, notes: string[]) => void;
}

const BRIDGE_KEY = "metardu-postgis-bridge-url";

export const PostgisPanel: React.FC<PostgisPanelProps> = ({ onImportPoints }) => {
  const [bridgeUrl, setBridgeUrl] = useState<string>(
    () => localStorage.getItem(BRIDGE_KEY) ?? "http://localhost:8787",
  );
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState<PgTableInfo[]>([]);
  const [busyTable, setBusyTable] = useState<string | null>(null);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    setTables([]);
    try {
      const t = await listPgTables({ bridgeUrl });
      setTables(t);
      setConnected(true);
      localStorage.setItem(BRIDGE_KEY, bridgeUrl);
      if (t.length === 0) setError("Connected, but geometry_columns lists no spatial tables.");
    } catch (err) {
      setConnected(false);
      setError(
        `Could not reach the bridge at ${bridgeUrl} — ${(err as Error).message}. ` +
        `Start it with: cd bridge && npm install && PGURL=postgres://… node postgis-bridge.mjs`,
      );
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    setConnected(false);
    setTables([]);
    setError(null);
  };

  const importLayer = async (t: PgTableInfo) => {
    setBusyTable(t.table);
    setError(null);
    try {
      const layer = await fetchPgLayer({ bridgeUrl }, t);
      if (layer.points.length === 0) {
        setError(`${t.table}: ${layer.warnings.join("; ") || "no decodable geometry"}`);
        return;
      }
      onImportPoints(layer.points, layer.name, layer.srid, layer.warnings);
    } catch (err) {
      setError(`${t.table}: ${(err as Error).message}`);
    } finally {
      setBusyTable(null);
    }
  };

  return (
    <div className="h-full flex bg-app">
      <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-auto">
        <div className="w-full max-w-[520px]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[3px] border border-line-strong bg-sunken flex items-center justify-center">
              <Database className="w-4.5 h-4.5 text-ink-2" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold text-ink leading-tight">PostGIS Link</h1>
              <p className="text-[11.5px] text-ink-3">
                Read-only municipal database access through the local bridge
              </p>
            </div>
            <div className="flex-1" />
            <span
              className={`text-[10.5px] px-2 py-0.5 rounded-full border tnum ${
                connected ? "border-accent/50 text-accent" : "border-line-strong text-ink-3"
              }`}
            >
              {connected ? "CONNECTED" : "OFFLINE"}
            </span>
          </div>

          <div className="mt-4 bg-panel border border-line-strong rounded-[4px]">
            <div className="px-4 py-3 border-b border-line">
              <span className="ui-label">Bridge endpoint</span>
              <div className="mt-1.5 flex gap-1.5">
                <input
                  className="ui-input flex-1 text-[12px] font-mono"
                  value={bridgeUrl}
                  onChange={(e) => setBridgeUrl(e.target.value)}
                  placeholder="http://localhost:8787"
                  disabled={connecting}
                />
                {connected ? (
                  <button onClick={disconnect} className="ui-btn text-[12px]" title="Disconnect">
                    <Unplug className="w-3.5 h-3.5" />
                    <span>Disconnect</span>
                  </button>
                ) : (
                  <button
                    onClick={connect}
                    disabled={connecting || !bridgeUrl}
                    className="ui-btn-accent text-[12px]"
                  >
                    {connecting ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plug className="w-3.5 h-3.5" />
                    )}
                    <span>{connecting ? "Connecting…" : "Connect"}</span>
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="px-4 py-2.5 border-b border-line bg-risk-high/5 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-risk-high shrink-0 mt-0.5" />
                <p className="text-[11.5px] text-ink-2 leading-relaxed break-words">{error}</p>
              </div>
            )}

            <div>
              {connected && tables.length > 0 ? (
                <ul>
                  {tables.map((t) => (
                    <li
                      key={`${t.table}.${t.geomCol}`}
                      className="flex items-center gap-3 px-4 py-2.5 border-b border-line last:border-b-0 hover:bg-raised/60"
                    >
                      <div className="min-w-0 flex-1">
                        <strong className="text-[12.5px] text-ink font-medium block truncate">
                          {t.table}
                          <span className="text-ink-3 font-normal"> · {t.geomCol}</span>
                        </strong>
                        <span className="text-[10.5px] text-ink-3 tnum">
                          {t.type} · SRID {t.srid || "—"}
                        </span>
                      </div>
                      <button
                        onClick={() => importLayer(t)}
                        disabled={busyTable !== null}
                        className="ui-btn shrink-0 text-[11.5px]"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{busyTable === t.table ? "Fetching…" : "Import"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : connected ? (
                <p className="px-4 py-3 text-[11.5px] text-ink-3">
                  No spatial tables listed. Check that the PostGIS extension is
                  installed and the role can read <code className="font-mono">geometry_columns</code>.
                </p>
              ) : (
                <p className="px-4 py-3 text-[11.5px] text-ink-3 leading-relaxed">
                  Enter the URL of your local <code className="font-mono">postgis-bridge.mjs</code>{" "}
                  process and connect. The bridge enforces read-only SELECT
                  forwarding; geometry is fetched as HexEWKB and decoded in the
                  workstation. Layers in another SRID are reprojected to the
                  working CRS during import — the operation is disclosed in the
                  import notes.
                </p>
              )}
            </div>
          </div>

          <p className="mt-3 text-[10.5px] text-ink-3 leading-relaxed">
            Run the bridge on a host that can reach PostgreSQL:
            <br />
            <code className="font-mono text-[10px]">cd bridge && npm install && PGURL=postgres://reader:secret@host:5432/gis node postgis-bridge.mjs</code>
          </p>
        </div>
      </div>
    </div>
  );
};
