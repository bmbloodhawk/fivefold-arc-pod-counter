import assert from "node:assert/strict";
import test from "node:test";
import { AccountHistory, MemoryAccountHistoryStore, accountHistoryStoreForEnvironment } from "../src/account-history.js";
import { createRealtimeServer } from "../src/app.js";
import { APPEARANCE_ACHIEVEMENTS } from "../src/appearance-milestones.js";
import { FirebasePlaytestLedger } from "../src/playtest-ledger.js";

function firebaseWireStore() {
  const values = new Map();
  let version = 0;
  const ledger = new FirebasePlaytestLedger({
    databaseUrl: "https://fixture.invalid",
    clientEmail: "fixture@example.test",
    privateKey: "fixture-only",
    fetchImpl: async (url, options) => {
      const request = new Request(url, options);
      const key = new URL(url).pathname;
      const current = values.get(key) ?? null;
      const etag = JSON.stringify(version);
      if (request.method === "GET") return Response.json(current, { headers: { etag } });
      const expected = request.headers.get("if-match");
      if (expected && expected !== etag && !(current === null && expected === "null_etag")) {
        return new Response(null, { status: 412 });
      }
      let value;
      try { value = JSON.parse(await request.text()); }
      catch { return new Response(null, { status: 400 }); }
      values.set(key, value);
      version += 1;
      return Response.json(value);
    },
  });
  ledger.accessToken = async () => "fixture-token";
  return ledger;
}


const fieldNotes = { id: "field-notes", name: "Field Notes", visual: { treatment: "grid" } };
const auth = { authorization: "Bearer qa-skin-player" };

async function fixture(t, { store, appEnv = "staging", configureAccounts = true, appearanceCatalog } = {}) {
  const accountHistory = configureAccounts && new AccountHistory({ store: accountHistoryStoreForEnvironment(store, appEnv) });
  const { server, service } = createRealtimeServer({
    appEnv, appearanceCatalog,
    appearanceSkins: [fieldNotes],
    accountHistory,
    accountVerifier: { async verify(token) {
      if (token !== "qa-skin-player") throw Object.assign(new Error("Sign in"), { status: 401 });
      return { providerSubject: token };
    } },
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { accountHistory, service, request: (path, options) => fetch("http://127.0.0.1:" + server.address().port + path, options) };
}

for (const appEnv of ["staging", "production"]) {
test(appEnv + " persists a verified unlock, its notification, and host sharing", async t => {
  const store = appEnv === "production" ? firebaseWireStore() : new MemoryAccountHistoryStore();
  const { accountHistory, service, request } = await fixture(t, { store, appEnv });
  const publicSkins = await (await request("/api/game-skins")).json();
  assert.deepEqual(publicSkins.skins.map(skin => [skin.id, skin.name]), [["staging-slate", "Slate"], ["staging-ember", "Ember"]]);
  const post = (path, body, headers = {}, method = "POST") => request(path, {
    method, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const preferencesPath = "/api/account/preferences";
  const detailPath = "/api/game-skins/field-notes";
  const saveSkin = id => post(preferencesPath, { personalSkinId: id, usePersonalSkin: true }, auth, "PUT");
  const getProfile = async () => (await (await request(preferencesPath, { headers: auth })).json());
  assert.equal((await request(preferencesPath)).status, 401);
  const locked = (await getProfile()).skins[0];
  assert.deepEqual([locked.name, locked.state, locked.visual, locked.artwork], ["Field Notes", "locked", undefined, undefined]);
  assert.equal((await request(detailPath)).status, 404);
  assert.equal((await request(detailPath, { headers: auth })).status, 404);
  assert.equal((await saveSkin("field-notes")).status, 403);
  assert.equal((await saveSkin("staging-slate")).status, 200);

  const accountId = await accountHistory.ensureAccount("qa-skin-player");
  for (let i = 1; i <= 9; i += 1) await accountHistory.saveCompletedGame(accountId, commanderFinish(i), null, milestones);
  const host = service.createConnection().connectionId;
  const guest = service.createConnection().connectionId;
  const connection = { "x-connection-id": host };
  assert.equal((await post("/api/rooms", { playerCount: 2, startingLife: 40, tableSkinId: "field-notes" }, connection)).status, 401);
  assert.equal((await post("/api/rooms", { playerCount: 2, startingLife: 40, tableSkinId: "field-notes", earnedTableSkinName: "Field Notes" }, { ...auth, ...connection })).status, 403);
  const { snapshot: { code } } = await (await post("/api/rooms", {
    playerCount: 2, startingLife: 40, gameFormat: "commander", tableSkinId: "staging-slate",
  }, connection)).json();
  const { snapshot: claimed } = service.claimSeat(code, guest, { seatId: 1 });
  const sharedPath = "/api/rooms/" + code + "/table-skin";
  const guestConnection = { "x-connection-id": guest };
  assert.equal((await post(sharedPath, { baseVersion: claimed.version, tableSkinId: "field-notes" }, { ...auth, ...connection })).status, 403);
  assert.equal((await request(sharedPath, { headers: guestConnection })).status, 404);
  const { snapshot: started } = service.startGame(code, host, { baseVersion: claimed.version });
  const gameId = service.room(code).gameId;
  service.declareWinner(code, host, { baseVersion: started.version, winnerSeatId: 0 });
  const saveFinishedGame = () => post("/api/account/games", { roomCode: code, gameId }, { ...auth, ...connection });
  const saved = await saveFinishedGame();
  assert.equal(saved.status, 201);
  const result = await saved.json();
  assert.deepEqual(skinAwards(result).map(award => [award.title, award.unlockedSkinName]), [["Field Journal", "Field Notes"]]);
  const retry = await saveFinishedGame();
  assert.equal(retry.status, 201);
  assert.deepEqual((await retry.json()).unlockedAchievements, []);
  const detail = await request(detailPath, { headers: auth });
  assert.equal(detail.status, 200);
  assert.match(detail.headers.get("cache-control"), /no-store/);
  assert.equal((await detail.json()).skin.name, "Field Notes");
  assert.equal((await saveSkin("field-notes")).status, 200);

  const changeSkin = (headers, tableSkinId = "field-notes") => post(sharedPath, {
    baseVersion: service.room(code).version, tableSkinId,
  }, headers);
  assert.equal((await changeSkin({ ...auth, ...guestConnection })).status, 403);
  assert.equal((await changeSkin(connection)).status, 401);
  assert.equal((await changeSkin({ ...auth, ...connection }, ["field-notes"])).status, 400);
  const changed = await changeSkin({ ...auth, ...connection });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).snapshot.config.earnedTableSkinName, "Field Notes");
  assert.equal((await request(sharedPath)).status, 401);
  const newHost = service.createConnection().connectionId;
  assert.equal((await request(sharedPath, { headers: { "x-connection-id": newHost } })).status, 403);
  const shared = await request(sharedPath, { headers: guestConnection });
  assert.equal(shared.status, 200);
  assert.match(shared.headers.get("cache-control"), /no-store/);
  assert.equal((await shared.json()).skin.name, "Field Notes");
  assert.equal((await request(detailPath, { headers: guestConnection })).status, 404);
  const createdWithSkin = await post("/api/rooms", { playerCount: 2, startingLife: 40, tableSkinId: "field-notes" },
    { ...auth, "x-connection-id": newHost });
  assert.equal(createdWithSkin.status, 201);
  assert.equal((await createdWithSkin.json()).snapshot.config.earnedTableSkinName, "Field Notes");

  const intermission = service.beginIntermission(code, host, { baseVersion: service.room(code).version }).snapshot;
  const transferred = service.leaveIntermission(code, host, { baseVersion: intermission.version }).snapshot;
  assert.equal(transferred.hostSeatId, 1);
  assert.equal(transferred.config.tableSkinId, null);
  assert.equal((await request(sharedPath, { headers: guestConnection })).status, 404);

  const restarted = await fixture(t, { store, appEnv });
  const { preferences, skins } = await (await restarted.request(preferencesPath, { headers: auth })).json();
  assert.equal(preferences.personalSkinId, "field-notes");
  assert.deepEqual([skins[0].name, skins[0].state], ["Field Notes", "new"]);
  const production = await fixture(t, { store, appEnv: appEnv === "staging" ? "production" : "staging" });
  assert.equal((await production.request(detailPath, { headers: auth })).status, 404);
  const isolated = await (await production.request(preferencesPath, { headers: auth })).json();
  assert.equal(isolated.preferences.personalSkinId, null);
  assert.equal(isolated.skins[0].state, "locked");
});
}

test("legacy invitation skins stay hidden until their grant release", async t => {
  const hidden = [
    { id: "skin-1790476356864", name: "Fractured", status: "Approved" },
    { id: "skin-1789600182594", name: "Bart the Mailman", status: "Approved" },
    { id: "neutral", name: "Carl MTG", status: "Approved" },
  ];
  const { request, service } = await fixture(t, {
    store: new MemoryAccountHistoryStore(), appEnv: "production",
    appearanceCatalog: { async read() { return { skins: hidden }; } },
  });
  const { skins } = await (await request("/api/game-skins")).json();
  assert.deepEqual(skins.map(skin => skin.name), ["Slate", "Ember"]);
  const host = service.createConnection().connectionId;
  for (const skin of hidden) {
    assert.equal((await request("/api/game-skins/" + skin.id)).status, 404);
    assert.equal((await request("/api/game-skins/" + skin.id, { headers: auth })).status, 404);
    const prefs = await request("/api/account/preferences", {
      method: "PUT", headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ personalSkinId: skin.id, usePersonalSkin: true }),
    });
    assert.equal(prefs.status, 400);
    const room = await request("/api/rooms", {
      method: "POST", headers: { ...auth, "x-connection-id": host, "content-type": "application/json" },
      body: JSON.stringify({ playerCount: 2, startingLife: 40, tableSkinId: skin.id }),
    });
    assert.equal(room.status, 403);
  }
});

test("an unconfigured profile reports a service error", async t => {
  const { request } = await fixture(t, { configureAccounts: false });
  const response = await request("/api/account/history", { headers: auth });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "ACCOUNT_NOT_CONFIGURED");
});

;

const milestones = Object.values(APPEARANCE_ACHIEVEMENTS).map(award => award.id);
const skinAwards = result => result.unlockedAchievements.filter(award => milestones.includes(award.id));
const day = 86_400_000;
const start = Date.UTC(2026, 0, 1, 12);

function commanderFinish(number, { regularPod = true, gameFormat = "commander" } = {}) {
  const playDate = regularPod ? Math.floor((number - 1) / 2) : 0;
  const completedAt = start + playDate * day + ((number - 1) % 2) * 3_600_000;
  const won = regularPod && number % 4 === 0;
  return {
    gameId: "appearance-game-" + number,
    seatId: 0,
    tableIdentity: "appearance-table-" + (regularPod ? playDate : number),
    startedAt: completedAt - 30 * 60_000,
    completedAt,
    sessionKind: "standard",
    game: { gameFormat, tableSize: 4, won, achievementFacts: { lowestLife: number === 44 ? 5 : 20 } },
    moments: [],
  };
}

test("the six appearance rewards land at distinct verified Commander milestones", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore() });
  const account = await history.ensureAccount("regular-pod");
  const deck = await history.createDeck(account, { name: "Favorite deck", commanderName: "Example Commander" });
  await history.saveGame(account, { tableSize: 4, won: true });
  await history.saveCompletedGame(account, commanderFinish(101, { gameFormat: "casual" }), deck.deckId, milestones);
  await assert.rejects(history.saveCompletedGame(account, {
    ...commanderFinish(102), sessionKind: "practice",
  }, deck.deckId, milestones), { code: "PRACTICE_GAME" });

  const earned = [];
  for (let number = 1; number <= 100; number += 1) {
    const completed = commanderFinish(number);
    const saved = await history.saveCompletedGame(account, completed, deck.deckId, milestones);
    for (const award of skinAwards(saved)) earned.push([number, award.id]);
    if (number === 10) {
      assert.deepEqual(skinAwards(await history.saveCompletedGame(account, completed, deck.deckId, milestones)), []);
    }
  }
  assert.deepEqual(earned, [
    [10, "appearance-field-notes"],
    [20, "appearance-rosewood"],
    [35, "appearance-tideglass"],
    [55, "appearance-ember-vault"],
    [75, "appearance-long-table"],
    [100, "appearance-crown-alloy"],
  ]);
  const summary = await history.summary(account);
  assert.equal(summary.achievements.filter(award => milestones.includes(award.id)).length, 6);
});

test("prior Commander history counts once a skin is approved and the theme still matters", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore() });
  const account = await history.ensureAccount("single-date-pod");
  for (let number = 1; number <= 10; number += 1) {
    const saved = await history.saveCompletedGame(account, commanderFinish(number, { regularPod: false }));
    assert.deepEqual(skinAwards(saved), []);
  }
  const approved = await history.saveCompletedGame(account, commanderFinish(11, { regularPod: false }), null, milestones);
  assert.deepEqual(skinAwards(approved).map(award => award.id), ["appearance-field-notes"]);
  for (let number = 12; number <= 100; number += 1) {
    const saved = await history.saveCompletedGame(account, commanderFinish(number, { regularPod: false }), null, milestones);
    assert.deepEqual(skinAwards(saved), []);
  }
});
