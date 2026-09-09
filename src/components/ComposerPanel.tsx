/**
 * Print Composer — template-driven statutory sheet designer.
 *
 * Left: template + page settings + element visibility.
 * Centre: live A-series preview (same engine as the exported SVG).
 * Right: properties for the selected element (map frame layers, fit,
 * fixed scale, text content) and export actions.
 */

import React, { useMemo, useRef, useState } from "react";
import { Download, Printer, Save, FolderOpen, Eye, EyeOff, Image } from "lucide-react";
import { PipelineResult } from "../types/spatial";
import {
  ComposerTemplate, ComposerElement, PageSizeKey, Orientation, pageDimsMm,
} from "../core/composer/template";
import { form4Preset, atlasPreset } from "../core/composer/presets";
import { renderTemplate, validateSheetSvg } from "../core/composer/render";
import { downloadSheetPng } from "../core/export/png-export";

interface ComposerPanelProps {
  result: PipelineResult;
}

const TEMPLATES: { id: string; label: string; make: () => ComposerTemplate }[] = [
  { id: "preset-form4", label: "Form 4 — Cadastral Mutation Plan", make: form4Preset },
  { id: "preset-atlas", label: "Regional Planning Atlas", make: atlasPreset },
];

const ELEMENT_LABELS: Record<ComposerElement["kind"], string> = {
  "map-frame": "Map frame",
  "title-block": "Title block",
  text: "Text",
  table: "Table",
  legend: "Legend",
  "north-arrow": "North arrow",
  "scale-bar": "Scale bar",
  "kpi-strip": "KPI strip",
  "method-note": "Method note",
  certification: "Certification",
  "approval-stamp": "Approval stamp",
  signoff: "Signoff",
  locator: "Locator inset",
};

export const ComposerPanel: React.FC<ComposerPanelProps> = ({ result }) => {
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [template, setTemplate] = useState<ComposerTemplate>(() => form4Preset());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>("map");
  const [fitPreview, setFitPreview] = useState(true);
  const [pngBusy, setPngBusy] = useState(false);
  const loadRef = useRef<HTMLInputElement>(null);

  const activeTemplate = useMemo<ComposerTemplate>(
    () => ({ ...template, elements: template.elements.filter((e) => !hiddenIds.has(e.id)) }),
    [template, hiddenIds],
  );
  const sheet = useMemo(() => renderTemplate(activeTemplate, result), [activeTemplate, result]);
  const problems = useMemo(() => validateSheetSvg(sheet.svg), [sheet.svg]);
  const selected = template.elements.find((e) => e.id === selectedId) ?? null;

  const updateElement = (id: string, patch: Partial<ComposerElement>) => {
    setTemplate((t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as ComposerElement) : e)),
    }));
  };

  const pickTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setTemplateId(id);
    setTemplate(t.make());
    setSelectedId(t.make().elements[0]?.id ?? null);
    setHiddenIds(new Set());
  };

  const downloadSvg = () => {
    const blob = new Blob([sheet.svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${template.id.replace(/preset-/, "")}_${result.metadata.title.replace(/\s+/g, "_")}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const printSheet = () => {
    const w = window.open("", "_blank", "width=980,height=760");
    if (!w) return;
    w.document.write(
      `<!doctype html><html><head><title>${template.title}</title><style>` +
      `@page { size: ${sheet.widthMm}mm ${sheet.heightMm}mm; margin: 0; }` +
      `html,body { margin:0; padding:0; background:#fff; } svg { width:100vw; height:auto; display:block; }` +
      `</style></head><body>${sheet.svg}<script>window.onload = () => window.print();</script></body></html>`,
    );
    w.document.close();
  };

  const saveTemplate = () => {
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${template.id}.metardu-template.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const loadTemplate = (file: File) => {
    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text) as ComposerTemplate;
        if (!parsed || !Array.isArray(parsed.elements) || !parsed.page) {
          throw new Error("not a composer template");
        }
        setTemplate(parsed);
        setTemplateId("");
        setHiddenIds(new Set());
        setSelectedId(parsed.elements[0]?.id ?? null);
      } catch (err) {
        alert(`Could not load template: ${(err as Error).message}`);
      }
    });
  };

  const dims = pageDimsMm(template.page);

  return (
    <div className="h-full flex overflow-hidden bg-app">
      {/* Left rail — template + page + elements */}
      <aside className="w-[230px] shrink-0 border-r border-line bg-panel flex flex-col overflow-y-auto">
        <div className="ui-panel-head">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Templates</h2>
          </div>
        </div>
        <div className="px-2.5 py-2 space-y-1">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => pickTemplate(t.id)}
              className={`w-full text-left px-2 py-1.5 rounded-[3px] text-[12px] border ${
                templateId === t.id
                  ? "border-accent/60 bg-accent/10 text-ink"
                  : "border-transparent text-ink-2 hover:bg-raised"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-2.5 pt-1 pb-2 border-b border-line">
          <span className="ui-label">Page</span>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <select
              className="ui-select text-[12px]"
              value={template.page.size}
              onChange={(e) =>
                setTemplate((t) => ({ ...t, page: { ...t.page, size: e.target.value as PageSizeKey } }))
              }
            >
              {(["A4", "A3", "A2", "A1"] as PageSizeKey[]).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              className="ui-select text-[12px]"
              value={template.page.orientation}
              onChange={(e) =>
                setTemplate((t) => ({
                  ...t,
                  page: { ...t.page, orientation: e.target.value as Orientation },
                }))
              }
            >
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
            </select>
          </div>
          <p className="mt-1.5 text-[10px] text-ink-3 tnum">
            {dims.w} × {dims.h} mm · 96 dpi
          </p>
        </div>

        <div className="px-2.5 py-2 flex-1">
          <span className="ui-label">Elements</span>
          <ul className="mt-1.5 space-y-0.5">
            {template.elements.map((el) => {
              const hidden = hiddenIds.has(el.id);
              return (
                <li key={el.id} className="flex items-center gap-1 group">
                  <button
                    onClick={() => setSelectedId(el.id)}
                    className={`flex-1 text-left px-1.5 py-1 rounded-[3px] text-[11.5px] truncate ${
                      selectedId === el.id ? "bg-raised text-ink" : "text-ink-2 hover:bg-raised/60"
                    }`}
                    title={el.id}
                  >
                    {ELEMENT_LABELS[el.kind]}
                    <span className="text-ink-3"> · {el.id}</span>
                  </button>
                  <button
                    onClick={() =>
                      setHiddenIds((s) => {
                        const next = new Set(s);
                        if (next.has(el.id)) next.delete(el.id);
                        else next.add(el.id);
                        return next;
                      })
                    }
                    className="ui-btn-icon w-6 h-6 opacity-60 group-hover:opacity-100"
                    title={hidden ? "Show element" : "Hide element"}
                  >
                    {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="px-2.5 py-2 border-t border-line flex gap-1.5">
          <button onClick={saveTemplate} className="ui-btn flex-1 text-[11.5px]">
            <Save className="w-3.5 h-3.5" />
            <span>Save JSON</span>
          </button>
          <button onClick={() => loadRef.current?.click()} className="ui-btn flex-1 text-[11.5px]">
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Load</span>
          </button>
          <input
            ref={loadRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadTemplate(f);
              e.target.value = "";
            }}
          />
        </div>
      </aside>

      {/* Centre — live preview */}
      <section className="flex-1 min-w-0 flex flex-col">
        <div className="h-9 shrink-0 border-b border-line bg-panel flex items-center gap-2 px-3">
          <span className="ui-label">Sheet preview</span>
          <span className="text-[11px] text-ink-3 tnum">
            {template.title} · {sheet.widthMm}×{sheet.heightMm} mm
          </span>
          <div className="flex-1" />
          {problems.length > 0 && (
            <span className="text-[11px] text-risk-high">{problems.join(" · ")}</span>
          )}
          <button
            onClick={() => setFitPreview((v) => !v)}
            className="ui-btn text-[11.5px]"
            title="Toggle fit-to-window"
          >
            {fitPreview ? "Fit" : "100%"}
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-sunken p-6 grid place-items-start">
          <div
            className={`bg-white shadow-lg ${fitPreview ? "[&>svg]:w-full [&>svg]:h-auto" : "[&>svg]:max-w-none"}`}
            style={fitPreview ? { maxWidth: 1100 } : undefined}
            dangerouslySetInnerHTML={{ __html: sheet.svg }}
          />
        </div>
      </section>

      {/* Right rail — properties + export */}
      <aside className="w-[250px] shrink-0 border-l border-line bg-panel flex flex-col overflow-y-auto">
        <div className="ui-panel-head">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Properties</h2>
            <p className="text-[10.5px] text-ink-3 mt-0.5">
              {selected ? ELEMENT_LABELS[selected.kind] : "Select an element"}
            </p>
          </div>
        </div>

        <div className="px-2.5 py-2.5 space-y-3 flex-1">
          {selected?.kind === "map-frame" && (
            <>
              <div>
                <span className="ui-label">Fit to</span>
                <select
                  className="ui-select w-full mt-1 text-[12px]"
                  value={selected.fit}
                  onChange={(e) => updateElement(selected.id, { fit: e.target.value as never })}
                >
                  <option value="boundary">Boundary</option>
                  <option value="features">All features</option>
                  <option value="suitability">Suitability grid</option>
                </select>
              </div>
              <div>
                <span className="ui-label">Scale</span>
                <input
                  className="ui-input w-full mt-1 text-[12px] tnum"
                  placeholder="auto (fit)"
                  inputMode="numeric"
                  value={selected.scaleDenominator ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, "");
                    updateElement(selected.id, { scaleDenominator: v ? Number(v) : null });
                  }}
                />
              </div>
              <div>
                <span className="ui-label">Layers</span>
                <div className="mt-1 space-y-1">
                  {(Object.keys(selected.layers) as (keyof typeof selected.layers)[]).map((k) => (
                    <label key={k} className="flex items-center gap-2 text-[12px] text-ink-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-[#d9a441]"
                        checked={selected.layers[k]}
                        onChange={(e) =>
                          updateElement(selected.id, {
                            layers: { ...selected.layers, [k]: e.target.checked },
                          })
                        }
                      />
                      {k}
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {selected?.kind === "text" && (
            <>
              <div>
                <span className="ui-label">Text</span>
                <textarea
                  className="ui-input w-full mt-1 text-[12px] h-20 resize-none"
                  value={selected.text}
                  onChange={(e) => updateElement(selected.id, { text: e.target.value })}
                />
                <p className="mt-1 text-[10px] text-ink-3">
                  Tokens: {"{LOCALITY} {COUNTRY} {CRS} {DATE}"}
                </p>
              </div>
              <div>
                <span className="ui-label">Size (pt)</span>
                <input
                  className="ui-input w-full mt-1 text-[12px] tnum"
                  value={selected.sizePt}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0) updateElement(selected.id, { sizePt: v });
                  }}
                />
              </div>
            </>
          )}

          {selected?.kind === "table" && (
            <>
              <div>
                <span className="ui-label">Source</span>
                <select
                  className="ui-select w-full mt-1 text-[12px]"
                  value={selected.source}
                  onChange={(e) => updateElement(selected.id, { source: e.target.value as never })}
                >
                  <option value="beacons">Beacon schedule</option>
                  <option value="hazards">Hazard exposure</option>
                  <option value="energy">Electrification</option>
                  <option value="telemetry">Pipeline telemetry</option>
                </select>
              </div>
              <div>
                <span className="ui-label">Max rows</span>
                <input
                  className="ui-input w-full mt-1 text-[12px] tnum"
                  value={selected.maxRows ?? ""}
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(/[^\d]/g, ""));
                    updateElement(selected.id, { maxRows: v > 0 ? v : undefined });
                  }}
                />
              </div>
            </>
          )}

          {selected && !["map-frame", "text", "table"].includes(selected.kind) && (
            <p className="text-[11.5px] text-ink-3 leading-relaxed">
              This element is fully computed from the pipeline result — it has no
              editable properties. Values render from live data only; the
              composer cannot inject figures that the pipeline did not produce.
            </p>
          )}
          {!selected && (
            <p className="text-[11.5px] text-ink-3">
              Select an element in the list to inspect it. Element geometry is
              authored in millimetres in the template JSON.
            </p>
          )}
        </div>

        <div className="px-2.5 py-2 border-t border-line space-y-1.5">
          <button onClick={downloadSvg} className="ui-btn w-full text-[12px]">
            <Download className="w-3.5 h-3.5" />
            <span>Download SVG</span>
          </button>
          <button
            onClick={async () => {
              setPngBusy(true);
              try {
                await downloadSheetPng(
                  sheet.svg, sheet.widthPx, sheet.heightPx,
                  `${template.id.replace("preset-", "")}_${result.metadata.title.replace(/\s+/g, "_")}_300dpi.png`,
                );
              } finally {
                setPngBusy(false);
              }
            }}
            disabled={pngBusy}
            className="ui-btn w-full text-[12px]"
          >
            <Image className="w-3.5 h-3.5" />
            <span>{pngBusy ? "Rasterising…" : "Download PNG · 300 DPI"}</span>
          </button>
          <button onClick={printSheet} className="ui-btn-accent w-full text-[12px]">
            <Printer className="w-3.5 h-3.5" />
            <span>Print sheet</span>
          </button>
        </div>
      </aside>
    </div>
  );
};
