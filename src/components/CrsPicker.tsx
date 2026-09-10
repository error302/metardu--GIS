import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check, Search, Globe } from "lucide-react";
import { searchCrs, resolveEpsg, getCRS, CRSDefinition } from "../core/crs";

interface CrsPickerProps {
  activeEpsg: number;
  onCrsChange: (epsg: number) => void;
}

/**
 * Searchable CRS selector — replaces the fixed dropdown from Phase A.
 * Built-in registry (all WGS84/Arc 1960 UTM zones + core global systems),
 * full-text search, and paste-any-EPSG resolution via epsg.io with offline
 * persistence of fetched definitions.
 */
export const CrsPicker: React.FC<CrsPickerProps> = ({ activeEpsg, onCrsChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const active = getCRS(activeEpsg);
  const results = useMemo(() => searchCrs(query, 60), [query]);
  const numericQuery = query.trim().replace(/^epsg:/i, "");
  const canFetch =
    /^\d{4,5}$/.test(numericQuery) && !results.some((r) => String(r.epsg) === numericQuery);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setStatus(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const pick = (def: CRSDefinition) => {
    onCrsChange(def.epsg);
    setOpen(false);
    setQuery("");
    setStatus(null);
  };

  const fetchEpsg = async () => {
    const code = Number(numericQuery);
    setStatus(`Fetching EPSG:${code} definition…`);
    const def = await resolveEpsg(code);
    if (def) {
      setStatus(null);
      pick(def);
    } else {
      setStatus(`EPSG:${code} not found or epsg.io unreachable — try another code.`);
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        className="ui-select w-[240px] flex items-center justify-between gap-1.5"
        onClick={() => setOpen((v) => !v)}
        title="Coordinate Reference System — click to search or paste an EPSG code"
      >
        <span className="truncate tnum">
          {active ? `EPSG:${active.epsg} — ${active.name}` : `EPSG:${activeEpsg}`}
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-ink-3" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-[340px] bg-panel border border-line rounded-[4px] shadow-2xl">
          <div className="flex items-center gap-2 px-2.5 h-9 border-b border-line">
            <Search className="w-3.5 h-3.5 text-ink-3 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setStatus(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (canFetch) fetchEpsg();
                  else if (results.length > 0) pick(results[0]);
                }
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search CRS or paste EPSG code…"
              className="flex-1 bg-transparent text-[12px] text-ink placeholder:text-ink-3 outline-none"
            />
          </div>

          <div className="max-h-[320px] overflow-y-auto py-1">
            {results.length === 0 && !canFetch && (
              <div className="px-3 py-2 text-[11px] text-ink-3">
                No match in the local registry{canFetch === false ? "" : ""}
              </div>
            )}
            {results.map((d) => (
              <button
                key={d.epsg}
                onClick={() => pick(d)}
                className="w-full px-3 py-1.5 flex items-center gap-2 text-left hover:bg-raised group"
              >
                <span className="w-[14px] shrink-0">
                  {d.epsg === activeEpsg && <Check className="w-3.5 h-3.5 text-accent" />}
                </span>
                <span className="tnum text-[11px] text-ink-3 w-[64px] shrink-0">
                  EPSG:{d.epsg}
                </span>
                <span className="text-[12px] text-ink truncate">{d.name}</span>
                <span className="ml-auto text-[10px] text-ink-3 shrink-0 max-w-[110px] truncate group-hover:hidden">
                  {d.region}
                </span>
              </button>
            ))}
            {canFetch && (
              <button
                onClick={fetchEpsg}
                className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-raised border-t border-line"
              >
                <Globe className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="text-[12px] text-ink">
                  Fetch <span className="tnum">EPSG:{numericQuery}</span> definition from epsg.io
                </span>
              </button>
            )}
          </div>

          {status && (
            <div className="px-3 py-2 border-t border-line text-[11px] text-ink-2">{status}</div>
          )}
        </div>
      )}
    </div>
  );
};
