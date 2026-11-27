import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { AccountHistory, MemoryAccountHistoryStore } from "../src/account-history.js";
import { createRealtimeServer } from "../src/app.js";
import { materializeEarnedAppearanceSkin } from "../src/appearance-artwork-payload.js";
import { SKIN_ACHIEVEMENTS } from "../src/appearance-collection.js";
import { NIGHT_WATCH_SKIN_ID } from "../src/appearance-milestones.js";
import { loadNightWatchSkin } from "../src/night-watch-skin.js";

test("Night Watch serves the reviewed sky, six faces and six tabs independently of the editable catalog", async () => {
  const release = await loadNightWatchSkin();
  assert.equal(release.id, NIGHT_WATCH_SKIN_ID);
  assert.equal(release.status, "Approved");
  const achievement = SKIN_ACHIEVEMENTS[release.id];
  const skin = await materializeEarnedAppearanceSkin({ ...release, achievement }, {
    read: () => assert.fail("A bundled reward must not need the Studio catalog"),
    readAsset: () => assert.fail("Mutable Studio artwork must not replace a bundled reward"),
  });
  assert.equal(skin.name, "Aurora Observatory · Night Watch");
  assert.equal(skin.rendererVersion, 2);
  assert.equal(skin.achievement.id, "appearance-night-watch");
  assert.equal(skin.counterDesign.navigationIcons, "native");
  assert.equal(Object.keys(skin).some(key => key.startsWith("preview") || key === "bundledAppearance"), false);

  const modes = ["life", "commander", "radiation", "poison", "energy", "generic"];
  function artworkHash(images) {
    const hash = createHash("sha256");
    for (const image of images) hash.update(Buffer.from(image.split(",")[1], "base64"));
    return hash.digest("hex");
  }
  for (const mode of modes) {
    assert.equal(skin.counterDesign.modes[mode].ringCrop, "full");
    assert.notEqual(skin.counterDesign.modes[mode].artAsset, skin.counterDesign.modes[mode].ringArtAsset);
    assert.equal(skin.counterDesign.modes[mode].icon, "configured");
    assert.equal(skin.symbolScale[mode], 100);
    assert.notEqual(skin.symbolAssets[mode], skin.counterDesign.modes[mode].artAsset);
  }
  assert.equal(artworkHash([skin.backgroundData, ...modes.map(mode => skin.counterRingArtData[mode])]),
    "7ee660189050a7ec570a2581c315071f3ccbd18891365a6a72bab65da89aed9d");
  assert.equal(artworkHash(modes.map(mode => skin.counterArtData[mode])),
    "d9e47136dd8aeab05418284ec3d288051ce9b4b2442dd0e18ff1622cbc94a153");
  assert.equal(artworkHash(modes.map(mode => skin.symbolData[mode])),
    "e567b3011788014da0694534ad0fb91d90c4dbee702624aca77073340c1e40e6");
});

test("the bundled skin requires an earned account or a seat at its host's shared table", async t => {
  const skin = await loadNightWatchSkin();
  const store = new MemoryAccountHistoryStore();
  const accountHistory = new AccountHistory({ store });
  const owner = await accountHistory.ensureAccount("earner");
  await store.update("account-history/accounts/" + owner + ".json", row => ({
    ...row, longTermAchievementIds: ["long-endurance-4"],
  }));
  const { server, service } = createRealtimeServer({
    feedbackPortalKey: "local-test", accountHistory, appearanceSkins: [skin],
    accountVerifier: { verify: async token => ({ providerSubject: token }) },
    appearanceCatalog: { read: async () => ({ skins: [{ id: skin.id, name: "Catalog copy", status: "Approved" }] }) },
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = "http://127.0.0.1:" + server.address().port;
  const req = (path, headers = {}, body) => fetch(origin + path, {
    method: body ? "POST" : "GET", headers: { ...headers, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const detail = "/api/game-skins/" + skin.id;
  assert.equal((await (await req("/api/game-skins")).json()).skins.some(row => row.id === skin.id), false);
  assert.equal((await req(detail)).status, 404);
  assert.equal((await req(detail, { authorization: "Bearer locked" })).status, 404);
  assert.equal((await req("/api/developer/skins/grant", { "x-feedback-portal-key": "local-test" }, {
    skinId: skin.id, accountId: owner,
  })).status, 400);
  const ownerHeader = { authorization: "Bearer earner" };
  const owned = await req(detail, ownerHeader);
  assert.equal(owned.status, 200);
  assert.equal((await owned.json()).skin.counterArtData.poison, skin.bundledAppearance.counterArtData.poison);

  const host = service.createConnection().connectionId;
  const guest = service.createConnection().connectionId;
  const made = await req("/api/rooms", { ...ownerHeader, "x-connection-id": host }, {
    playerCount: 2, startingLife: 40, tableSkinId: skin.id,
  });
  assert.equal(made.status, 201);
  const { snapshot: { code } } = await made.json();
  service.claimSeat(code, guest, { seatId: 1 });
  const tablePath = "/api/rooms/" + code + "/table-skin";
  assert.equal((await req(tablePath)).status, 401);
  const shared = await req(tablePath, { "x-connection-id": guest });
  assert.equal(shared.status, 200);
  assert.equal((await shared.json()).skin.counterArtData.energy, skin.bundledAppearance.counterArtData.energy);
  assert.equal((await req(detail, { "x-connection-id": guest })).status, 404);
});
