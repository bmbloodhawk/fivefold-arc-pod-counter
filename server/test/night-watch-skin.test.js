import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { AccountHistory, MemoryAccountHistoryStore } from "../src/account-history.js";
import { createRealtimeServer } from "../src/app.js";
import { SKIN_ACHIEVEMENTS } from "../src/appearance-collection.js";
import { NIGHT_WATCH_SKIN_ID } from "../src/appearance-milestones.js";
import { loadNightWatchSkin } from "../src/night-watch-skin.js";

test("the Night Shift release contains the reviewed sky and six dial faces in order", async () => {
  const skin = await loadNightWatchSkin();
  assert.equal(skin.id, NIGHT_WATCH_SKIN_ID);
  assert.equal(SKIN_ACHIEVEMENTS[skin.id].id, "appearance-night-watch");
  assert.equal(skin.name, "Aurora Observatory · Night Watch");
  assert.equal(skin.rendererVersion, 2);
  assert.equal(skin.counterDesign.navigationIcons, "native");
  assert.equal(Object.keys(skin).some(key => key.startsWith("preview") || key === "versions"), false);

  const modes = ["life", "commander", "radiation", "poison", "energy", "generic"];
  // The digest covers the exact reviewed sky and dial image bytes in mode order.
  const hash = createHash("sha256");
  for (const image of [skin.backgroundData, ...modes.map(mode => skin.counterArtData[mode])]) {
    hash.update(Buffer.from(image.split(",")[1], "base64"));
  }
  assert.equal(hash.digest("hex"), "7ee660189050a7ec570a2581c315071f3ccbd18891365a6a72bab65da89aed9d");
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
  assert.equal((await owned.json()).skin.counterArtData.poison, skin.counterArtData.poison);

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
  assert.equal((await shared.json()).skin.counterArtData.energy, skin.counterArtData.energy);
  assert.equal((await req(detail, { "x-connection-id": guest })).status, 404);
});
