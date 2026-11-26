import assert from "node:assert/strict";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AccountHistory, MemoryAccountHistoryStore } from "../src/account-history.js";
import { loadAppearanceSkins, SKIN_ACHIEVEMENTS } from "../src/appearance-collection.js";
import { createRealtimeServer } from "../src/app.js";

const fieldNotes = "field-notes";
const award = "appearance-field-notes";
const skinRef = { personalSkinId: fieldNotes, usePersonalSkin: true };

async function loadTestPack(t, ids) {
  const visual = { schemaVersion: 1, treatment: "grid", background: "#101512", surface: "#18201b",
    text: "#eeeedd", muted: "#bbc8bc", accent: "#d5d6a5", border: "#849c88" };
  const pack = { version: 1, initialSkinId: ids[0], expiresAt: 1,
    skins: ids.map(id => ({ id, name: id === fieldNotes ? "Field Notes" : "Other skin", visual })) };
  const key = randomBytes(32), iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const bytes = Buffer.concat([iv, cipher.update(JSON.stringify(pack)), cipher.final(), cipher.getAuthTag()]);
  const path = join(tmpdir(), "field-notes-" + randomUUID() + ".enc");
  await writeFile(path, bytes);
  t.after(() => unlink(path));
  return { path, key: key.toString("base64url") };
}

test("the collection substitutes the reviewed Field Notes design only for its registered pack entry", async t => {
  const pack = await loadTestPack(t, ["rosewood", fieldNotes, "tideglass", "neutral"]);
  const skins = await loadAppearanceSkins(pack);
  assert.deepEqual(skins.map(skin => skin.id), ["rosewood", fieldNotes, "tideglass"]);
  const revised = skins[1];
  assert.equal(revised.name, "Field Notes");
  assert.equal(revised.rendererVersion, 2);
  assert.equal(revised.visual, undefined);
  assert.equal(revised.tableDesign.titleInk, "#5a402b");
  assert.equal(revised.tableDesign.stepInk, "#664528");
  assert.equal(revised.surfaceDesign.surfaces.playerCards.typography.value.shadow, "none");
  assert.deepEqual(Object.values(revised.counterDesign.modes).map(mode => mode.captionBacking), Array(6).fill("compact"));
  for (const index of [0, 2]) assert.equal(skins[index].visual.treatment, "grid");
  assert.deepEqual(await loadAppearanceSkins({ ...pack, key: "" }), []);
  const otherOnly = await loadAppearanceSkins(await loadTestPack(t, ["rosewood"]));
  assert.deepEqual(otherOnly.map(skin => skin.id), ["rosewood"]);
});

test("previous Field Journal awards restore, select and share revised Field Notes without another game", async t => {
  const store = new MemoryAccountHistoryStore();
  const history = new AccountHistory({ store });
  const legacy = await history.ensureAccount("legacy");
  const recovered = await history.ensureAccount("recovered");
  await store.update("account-history/accounts/" + legacy + ".json", row => ({
    ...row, longTermAchievementIds: [award], seenAchievementIds: [award],
  }));
  await history.savePreferences(legacy, skinRef);
  const progress = { games: {}, awards: { [award]: { gameId: "game_historical", earnedAt: 1000, ruleVersion: 1 } } };
  const progressPath = "account-history/verified-progress/" + recovered + ".json";
  await store.write(progressPath, progress);
  const appearanceSkins = await loadAppearanceSkins(await loadTestPack(t, [fieldNotes]));
  const { server, service } = createRealtimeServer({ appEnv: "staging", appearanceSkins, accountHistory: history,
    accountVerifier: { verify: async subject => ({ providerSubject: subject }) } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const origin = "http://127.0.0.1:" + server.address().port;
  function request(path, subject, method = "GET", body, connection) {
    const headers = { "content-type": "application/json" };
    if (subject) headers.authorization = "Bearer " + subject;
    if (connection) headers["x-connection-id"] = connection;
    return fetch(origin + path, { method, headers, body: JSON.stringify(body) });
  }
  const detail = "/api/game-skins/" + fieldNotes, prefs = "/api/account/preferences";
  assert.equal((await (await request("/api/game-skins")).json()).skins.some(skin => skin.id === fieldNotes), false);
  assert.equal((await request(detail)).status, 404);
  for (const [subject, state] of [["legacy","unlocked"], ["recovered","new"], ["locked","locked"]]) {
    const profile = await (await request(prefs, subject)).json();
    const choice = profile.skins.find(skin => skin.id === fieldNotes);
    assert.equal(choice.achievement.id, SKIN_ACHIEVEMENTS[fieldNotes].id);
    assert.equal(choice.state, state);
    if (subject === "legacy") {
      assert.equal(profile.preferences.personalSkinId, fieldNotes);
      assert.equal(profile.preferences.usePersonalSkin, true);
    }
    const held = state !== "locked";
    assert.equal((await request(prefs, subject, "PUT", skinRef)).status, held ? 200 : 403);
    const response = await request(detail, subject);
    assert.equal(response.status, held ? 200 : 404);
    if (held) {
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.equal((await response.json()).skin.counterDesign.modes.life.captionBacking, "compact");
    }
  }
  const host = service.createConnection().connectionId;
  const table = await request("/api/rooms", "legacy", "POST", { playerCount: 2, startingLife: 40, tableSkinId: fieldNotes }, host);
  assert.equal(table.status, 201);
  const { snapshot: { code } } = await table.json();
  const guest = service.createConnection().connectionId;
  service.claimSeat(code, guest, { seatId: 1 });
  const shared = await request("/api/rooms/" + code + "/table-skin", null, "GET", undefined, guest);
  assert.equal(shared.status, 200);
  assert.equal((await shared.json()).skin.tableDesign.titleInk, "#5a402b");
  assert.equal(await store.read("account-history/verified-progress/" + legacy + ".json"), null);
  assert.deepEqual(await store.read(progressPath), progress);
});
