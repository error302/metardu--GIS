/**
 * Phase B CRS registry tests — programmatic UTM expansion, search, session
 * definitions, and coordinate math sanity across generated zones.
 */
import * as assert from "assert";
import {
  listSupportedEPSG,
  getCRS,
  searchCrs,
  registerCrsDefinition,
  restoreSessionCrsDefinitions,
  toWGS84,
  fromWGS84,
} from "../src/core/crs";

/* Full WGS84 UTM zone coverage (both hemispheres) */
for (const zone of [1, 15, 36, 37, 60]) {
  for (const south of [false, true]) {
    const epsg = (south ? 32700 : 32600) + zone;
    const def = getCRS(epsg);
    assert.ok(def, `EPSG:${epsg} must exist`);
    assert.ok(def!.name.includes(`zone ${zone}${south ? "S" : "N"}`), def!.name);
  }
}
assert.ok(getCRS(21037), "Arc 1960 / UTM 37S present");
assert.ok(getCRS(21035), "Arc 1960 / UTM 35S present");
assert.ok(getCRS(21097), "Arc 1960 / UTM 37N present");
assert.ok(getCRS(4326), "WGS84 geographic present");
assert.ok(getCRS(3857), "Web Mercator present");
assert.strictEqual(
  listSupportedEPSG().filter((d) => d.epsg === 32636).length,
  1,
  "no duplicate zone defs",
);

/* Round-trip math through a generated southern zone (Dar es Salaam) */
{
  const [e, n] = fromWGS84(32737, 39.28, -6.8); // zone 37S forward
  assert.ok(e > 500000 && e < 560000 && n > 9200000 && n < 9300000, `zone37S forward: ${e},${n}`);
  const [lon, lat] = toWGS84(32737, e, n);
  assert.ok(Math.abs(lon - 39.28) < 1e-6 && Math.abs(lat + 6.8) < 1e-6, "zone37S round-trip");
}

/* Search: code prefix, name substring, region */
{
  const byCode = searchCrs("32637");
  assert.ok(byCode.some((d) => d.epsg === 32637));
  const byName = searchCrs("arc 1960");
  assert.ok(byName.every((d) => /arc 1960/i.test(d.name)) && byName.length >= 5);
  const byRegion = searchCrs("Kenya");
  assert.ok(byRegion.some((d) => d.epsg === 21037));
  // Exact-code search ranks the exact match first
  const first = searchCrs("4326")[0];
  assert.strictEqual(first.epsg, 4326);
}

/* Session definition registration + lookup + restore round-trip */
{
  const def = {
    epsg: 99999,
    name: "Test local grid",
    proj4: "+proj=tmerc +lat_0=0 +lon_0=36 +k=0.9996 +x_0=500000 +y_0=0 +ellps=WGS84 +units=m +no_defs",
    units: "m" as const,
    region: "Session definition",
  };
  registerCrsDefinition(def, false); // do not pollute localStorage in tests
  assert.ok(getCRS(99999));
  assert.ok(listSupportedEPSG().some((d) => d.epsg === 99999));
  const [lon, lat] = toWGS84(99999, 500000, 0);
  assert.ok(Math.abs(lon - 36) < 1e-6 && Math.abs(lat) < 1e-6, "custom def transforms");
  restoreSessionCrsDefinitions(); // must not throw
}

console.log("crs-registry.test.ts: all assertions passed");
