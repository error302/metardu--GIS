/**
 * NASA FIRMS watchlist tests — URL building, CSV parsing (VIIRS + MODIS
 * column sets), deterministic alert ids, watchlist store roundtrip with a
 * stub storage, new-alert diffing, seen-ring trimming, and check
 * orchestration with stubbed fetch (success, HTTP failure, invalid key).
 */
import * as assert from "assert";
import {
  firmsFnv1a,
  firmsAlertId,
  normalizeAcqTime,
  validateMapKey,
  validateWatchBbox,
  buildAreaCsvUrl,
  parseFirmsCsv,
  sortAlerts,
  makeWatchlist,
  loadWatchlists,
  saveWatchlists,
  trimSeenIds,
  diffAlerts,
  applyCheck,
  checkWatchlist,
  WATCHLIST_STORAGE_KEY,
  FirmsSource,
  FireWatchlist,
  WatchlistStorage,
} from "../src/core/osint/firms";
import { OverpassBbox } from "../src/core/osint/overpass";

const BBOX: OverpassBbox = { lonMin: 36.7, latMin: -1.45, lonMax: 36.9, latMax: -1.2 };

/* ---------------- primitives ---------------- */

{
  // Standard FNV-1a 32-bit test vector.
  assert.strictEqual(firmsFnv1a("hello"), "4f9f2cab", "known FNV-1a vector");

  assert.strictEqual(normalizeAcqTime("1955"), "19:55");
  assert.strictEqual(normalizeAcqTime("105"), "01:05", "FIRMS strips leading zeros");
  assert.strictEqual(normalizeAcqTime("0"), "00:00");
  assert.strictEqual(normalizeAcqTime(""), "");
  assert.strictEqual(normalizeAcqTime("abc"), "");

  const id1 = firmsAlertId("VIIRS_NOAA20_NRT", -1.23456, 36.87654, "2026-09-09", "2015");
  const id2 = firmsAlertId("VIIRS_NOAA20_NRT", -1.23456, 36.87654, "2026-09-09", "2015");
  assert.strictEqual(id1, id2, "same detection -> same id");
  assert.notStrictEqual(
    id1,
    firmsAlertId("VIIRS_NOAA20_NRT", -1.23456, 36.87754, "2026-09-09", "2015"),
    "different position (beyond ~100 m rounding) -> different id",
  );
  assert.notStrictEqual(
    id1,
    firmsAlertId("MODIS_NRT", -1.23456, 36.87654, "2026-09-09", "2015"),
    "different source -> different id",
  );
}

/* ---------------- validation + URL ---------------- */

{
  assert.strictEqual(validateMapKey("abcdef1234567890"), null, "well-formed key");
  assert.ok(validateMapKey("") !== null, "empty key rejected");
  assert.ok(validateMapKey("short") !== null, "too-short key rejected");
  assert.ok(validateMapKey("has space 12345") !== null, "spaces rejected");

  assert.strictEqual(validateWatchBbox(BBOX), null);
  assert.ok(validateWatchBbox({ lonMin: 5, latMin: 0, lonMax: 4, latMax: 1 }) !== null);

  const url = buildAreaCsvUrl("KEY1234567890", "VIIRS_NOAA20_NRT", BBOX, 3);
  assert.ok(
    url.endsWith("/VIIRS_NOAA20_NRT/36.7,-1.45,36.9,-1.2/3"),
    "west,south,east,north order with day range",
  );
  assert.ok(url.startsWith("https://firms.modaps.eosdis.nasa.gov/api/area/csv/KEY1234567890"));
  assert.throws(
    () => buildAreaCsvUrl("KEY1234567890", "MODIS_NRT", { lonMin: 5, latMin: 0, lonMax: 4, latMax: 1 }, 3),
  );
  // Day range clamped to the documented 1-10 window.
  assert.ok(buildAreaCsvUrl("KEY1234567890", "MODIS_NRT", BBOX, 99).endsWith("/10"));
}

/* ---------------- CSV parsing ---------------- */

const VIIRS_CSV = `latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-1.3001,36.8023,344.2,1.2,1.1,2026-09-09,2015,S-NPP,VIIRS,l,2.0NRT,298.7,4.6,N
-1.3521,36.7999,359.8,1.1,1.0,2026-09-09,705,Suomi NPP,VIIRS,85,2.0NRT,301.2,12.3,D
not,a,valid,row
-1.4001,999.0,340.0,1.0,1.0,2026-09-08,0330,NOAA-20,VIIRS,h,2.0NRT,300.0,2.0,D`;

const MODIS_CSV = `latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
-1.2202,36.8301,322.7,1.5,1.3,2026-09-08,2350,Terra,MODIS,72,6.1,NRT,301.5,8.9,N`;

{
  const viirs = parseFirmsCsv(VIIRS_CSV, "VIIRS_SNPP_NRT" as FirmsSource);
  assert.strictEqual(viirs.length, 2, "malformed + out-of-range-lon rows skipped");
  const a = viirs[0];
  assert.strictEqual(a.acqDate, "2026-09-09");
  assert.strictEqual(a.acqTime, "20:15", "raw 2015 normalized");
  assert.strictEqual(a.brightnessK, 344.2);
  assert.strictEqual(a.confidenceRaw, "l");
  assert.strictEqual(a.confidencePct, null, "letter confidence is not a percentage");
  assert.strictEqual(a.frpMW, 4.6);
  assert.strictEqual(a.dayNight, "N");
  const b = viirs[1];
  assert.strictEqual(b.acqTime, "07:05", "195-style stripped time padded to 07:05");
  assert.strictEqual(b.confidencePct, 85, "numeric confidence kept");

  const modis = parseFirmsCsv(MODIS_CSV, "MODIS_NRT" as FirmsSource);
  assert.strictEqual(modis.length, 1, "MODIS column set parses");
  assert.strictEqual(modis[0].brightnessK, 322.7, "brightness column mapped");
  assert.strictEqual(modis[0].acqTime, "23:50");

  assert.deepStrictEqual(parseFirmsCsv("latitude,longitude\n", "MODIS_NRT" as FirmsSource), [], "header-only");
  assert.deepStrictEqual(parseFirmsCsv("", "MODIS_NRT" as FirmsSource), [], "empty body");

  // Deterministic ids across parses.
  const again = parseFirmsCsv(VIIRS_CSV, "VIIRS_SNPP_NRT" as FirmsSource);
  assert.deepStrictEqual(viirs.map((x) => x.alertId), again.map((x) => x.alertId));
}

{
  const partial = (date: string, time: string) => ({ acqDate: date, acqTime: time });
  const sorted = sortAlerts([
    partial("2026-09-08", "23:50"),
    partial("2026-09-09", "01:05"),
    partial("2026-09-09", "20:15"),
  ] as Parameters<typeof sortAlerts>[0]);
  assert.strictEqual(sorted[0].acqTime, "20:15", "newest date+time first");
  assert.strictEqual(sorted[2].acqDate, "2026-09-08");
}

/* ---------------- watchlist store ---------------- */

function memoryStorage(): WatchlistStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

{
  const store = memoryStorage();
  assert.deepStrictEqual(loadWatchlists(store), [], "empty storage");
  assert.deepStrictEqual(loadWatchlists(null), [], "null storage tolerated");

  const list = makeWatchlist("Parcel fire watch", BBOX, ["VIIRS_NOAA20_NRT" as FirmsSource], 3, "fw-test1");
  assert.ok(list.id === "fw-test1");
  assert.strictEqual(list.lastCheckedAt, null);
  assert.deepStrictEqual(list.seenIds, []);

  saveWatchlists(store, [list]);
  const loaded = loadWatchlists(store);
  assert.strictEqual(loaded.length, 1);
  assert.strictEqual(loaded[0].id, "fw-test1");
  assert.deepStrictEqual(loaded[0].bbox, BBOX);

  store.data.set(WATCHLIST_STORAGE_KEY, "{corrupt json");
  assert.deepStrictEqual(loadWatchlists(store), [], "corrupt state -> empty");
}

/* ---------------- diffing + applyCheck ---------------- */

const alert = (id: string, date = "2026-09-09", time = "20:15") => makeAlert(id, date, time);

function makeAlert(id: string, date?: string, time?: string) {
  return {
    alertId: id,
    source: "VIIRS_NOAA20_NRT" as FirmsSource,
    lat: -1.3,
    lon: 36.8,
    brightnessK: 350,
    acqDate: date ?? "2026-09-09",
    acqTime: time ?? "20:15",
    satellite: "S-NPP",
    instrument: "VIIRS",
    confidenceRaw: "h",
    confidencePct: null,
    frpMW: 5,
    dayNight: "N",
  };
}

{
  const list: FireWatchlist = {
    ...makeWatchlist("w", BBOX, ["VIIRS_NOAA20_NRT" as FirmsSource], 3, "fw-diff"),
    seenIds: ["a", "b"],
  };
  const alerts = [alert("a"), alert("c"), alert("b"), alert("d")];
  const fresh = diffAlerts(list, alerts);
  assert.deepStrictEqual(
    fresh.map((a) => a.alertId),
    ["c", "d"],
    "exact set difference against the seen ring",
  );

  const updated = applyCheck(list, alerts, "2026-09-10T00:00:00Z");
  assert.strictEqual(updated.lastCheckedAt, "2026-09-10T00:00:00Z");
  assert.strictEqual(updated.lastTotal, 4);
  assert.ok(updated.seenIds.includes("c") && updated.seenIds.includes("d"));
  assert.deepStrictEqual(diffAlerts(updated, alerts), [], "second check finds nothing new");
  assert.strictEqual(list.seenIds.length, 2, "original watchlist untouched (pure)");
}

{
  assert.deepStrictEqual(trimSeenIds(["a", "b", "c"], 5), ["a", "b", "c"]);
  assert.deepStrictEqual(trimSeenIds(["a", "b", "c", "d", "e"], 3), ["c", "d", "e"], "oldest dropped");
}

/* ---------------- check orchestration (stubbed fetch) ---------------- */

const jsonResponse = (body: string, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response);

{
  const list = makeWatchlist(
    "w",
    BBOX,
    ["VIIRS_NOAA20_NRT" as FirmsSource, "MODIS_NRT" as FirmsSource],
    2,
    "fw-check",
  );

  // Two sources fetched in parallel; VIIRS returns one alert, MODIS one.
  const calls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    if (String(url).includes("VIIRS_NOAA20_NRT")) return jsonResponse(VIIRS_CSV);
    return jsonResponse(MODIS_CSV);
  }) as unknown as typeof fetch;

  const out = await checkWatchlist(list, "KEY1234567890", fetchImpl);
  assert.strictEqual(calls.length, 2, "one request per source");
  assert.strictEqual(out.alerts.length, 3, "union of both sources");
  assert.strictEqual(out.newAlerts.length, 3, "first check -> all new");
  assert.strictEqual(out.endpoints.length, 2);

  // Re-check with the SAME data after applying the first check: nothing new.
  const updated = applyCheck(list, out.alerts, out.checkedAt);
  const out2 = await checkWatchlist(updated, "KEY1234567890", fetchImpl);
  assert.strictEqual(out2.newAlerts.length, 0, "same detections are not new");
  assert.strictEqual(out2.alerts.length, 3);
}

{
  const list = makeWatchlist("w", BBOX, ["VIIRS_NOAA20_NRT" as FirmsSource], 1, "fw-err");

  const httpErr = (async () => jsonResponse("nope", 403)) as unknown as typeof fetch;
  await assert.rejects(
    () => checkWatchlist(list, "KEY1234567890", httpErr),
    /HTTP 403|busy or unreachable/,
    "HTTP failure surfaces",
  );

  const invalidKey = (async () => jsonResponse("Invalid MAP_KEY")) as unknown as typeof fetch;
  await assert.rejects(
    () => checkWatchlist(list, "BADKEY12345", invalidKey),
    /MAP_KEY/,
    "invalid key gets the actionable hint",
  );

  const netErr = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  await assert.rejects(() => checkWatchlist(list, "KEY1234567890", netErr), /unreachable|CORS/);

  await assert.rejects(
    () => checkWatchlist(list, "", jsonResponse("")),
    /MAP_KEY is required/,
  );
}
