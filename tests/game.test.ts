import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine, character, outcome } from "../server/engine.js";
import { Store } from "../server/store.js";
import { OpenAiGm, RulesGm, type Gm } from "../server/gm.js";
import type { Room } from "../shared/types.js";
import { createGameServer } from "../server/app.js";
import { createServer } from "node:http";
import { io as clientSocket } from "socket.io-client";

const hero = {
  name: "潮旅人",
  race: "human" as const,
  job: "guardian" as const,
  stats: { strength: 2, agility: 1, insight: 3 },
};
function setup(roll = 20, gm: Gm = new RulesGm(), path = ":memory:") {
  const store = new Store(path),
    engine = new Engine(store, gm, {
      graceMs: 10,
      callLimit: 20,
      tokenBudget: 100000,
      roll: () => roll,
    });
  const a = store.register(`甲${randomUUID().slice(0, 6)}`, "password1"),
    b = store.register(`乙${randomUUID().slice(0, 6)}`, "password2");
  return { store, engine, a, b };
}
async function command(
  e: Engine,
  id: string,
  user: string,
  type: string,
  data: Record<string, unknown> = {},
  key = randomUUID(),
) {
  await e.execute(id, user, {
    type,
    data,
    key,
    revision: e.store.get(id).revision,
  });
}
async function start(
  e: Engine,
  mode: "solo" | "coop",
  users: { id: string; name: string }[],
) {
  const room = e.create(users[0], mode);
  for (const u of users) {
    if (u !== users[0]) e.join(room.id, u);
    e.setConnected(room.id, u.id, true);
    await command(e, room.id, u.id, "character", { ...hero, name: u.name });
    await command(e, room.id, u.id, "ready");
  }
  await command(e, room.id, users[0].id, "start");
  return room.id;
}
async function act(e: Engine, id: string, intent: string, target?: string) {
  const user = e.view(id, e.store.get(id).members[0].userId).activeActorId!;
  await command(e, id, user, "action", {
    intent,
    ...(target ? { target } : {}),
  });
  const p = e.store.get(id).session?.pending;
  if (p) await command(e, id, user, "roll", { checkId: p.id });
  const v = e.store.get(id).session?.vote;
  if (v)
    for (const voter of v.required.filter((u) => !v.approvals.includes(u)))
      await command(e, id, voter, "vote", { approve: true });
}
async function peacefulQuest(e: Engine, id: string) {
  await act(e, id, "talk");
  await act(e, id, "move", "marsh");
  await act(e, id, "observe");
  await act(e, id, "move", "tower");
  await act(e, id, "talk");
  await act(e, id, "interact");
}

test("D20 natural 1/20 override bonuses; ordinary threshold stays exact", () => {
  assert.equal(outcome(1, 99, 2), "critical_failure");
  assert.equal(outcome(20, -99, 90), "critical_success");
  assert.equal(outcome(9, 3, 13), "failure");
  assert.equal(outcome(10, 3, 13), "success");
});
test("point-buy rejects overspending and fractional stats; starting equipment is rules-owned", () => {
  assert.throws(() =>
    character({ ...hero, stats: { strength: 4, agility: 4, insight: 4 } }),
  );
  assert.throws(() =>
    character({ ...hero, stats: { strength: 2.5, agility: 1.5, insight: 2 } }),
  );
  const c = character(hero);
  assert.deepEqual(c.equipment, ["鐵劍", "圓盾", "皮甲"]);
  assert.equal(c.potions, 2);
});
test("solo adventure completes by diplomacy, levels up and carries history into the sequel", async () => {
  const { store, engine: e, a } = setup();
  try {
    const id = await start(e, "solo", [a]);
    await peacefulQuest(e, id);
    let r = store.get(id);
    assert.equal(r.phase, "won");
    assert.equal(r.members[0].character!.level, 2);
    const gold = r.members[0].character!.gold,
      count = r.events.length;
    await command(e, id, a.id, "next");
    r = store.get(id);
    assert.equal(r.session!.quest, 1);
    assert.equal(r.members[0].character!.gold, gold);
    assert.ok(r.events.length > count);
    await peacefulQuest(e, id);
    assert.equal(store.get(id).phase, "won");
    assert.equal(store.get(id).members[0].character!.level, 3);
    await assert.rejects(command(e, id, a.id, "next"));
  } finally {
    store.close();
  }
});
test("normal failures grant essential clue after two attempts (no story deadlock)", async () => {
  const { store, engine: e, a } = setup(2);
  try {
    const id = await start(e, "solo", [a]);
    await act(e, id, "observe");
    assert.equal(e.view(id, a.id).session!.clues, 0);
    await act(e, id, "observe");
    assert.equal(e.view(id, a.id).session!.clues, 1);
  } finally {
    store.close();
  }
});
test("critical failure applies health and confusion; critical success grants extra gold", async () => {
  const { store, engine: e, a } = setup(1);
  try {
    const id = await start(e, "solo", [a]),
      hp = store.get(id).members[0].character!.hp;
    await act(e, id, "observe");
    const c = store.get(id).members[0].character!;
    assert.equal(c.hp, hp - 2);
    assert.equal(c.confused, 1);
    await command(e, id, a.id, "action", { intent: "observe" });
    assert.equal(store.get(id).session!.pending!.modifier, 2);
  } finally {
    store.close();
  }
});
test("combat consumes focus, applies enemy retaliation, clears guard and can finish quest", async () => {
  const { store, engine: e, a } = setup();
  try {
    const id = await start(e, "solo", [a]);
    await act(e, id, "observe");
    await act(e, id, "move", "marsh");
    await act(e, id, "observe");
    await act(e, id, "move", "tower");
    await act(e, id, "skill");
    let r = store.get(id);
    assert.equal(r.members[0].character!.focus, 2);
    assert.equal(r.session!.enemyHp, 2);
    assert.equal(r.members[0].character!.hp, r.members[0].character!.maxHp - 3);
    await act(e, id, "attack");
    assert.equal(e.view(id, a.id).session!.objectiveReady, true);
    await act(e, id, "interact");
    assert.equal(store.get(id).phase, "won");
  } finally {
    store.close();
  }
});
test("same command/die cannot resolve twice, even with a new request key", async () => {
  const { store, engine: e, a } = setup();
  try {
    const id = await start(e, "solo", [a]);
    await command(e, id, a.id, "action", { intent: "observe" });
    const checkId = store.get(id).session!.pending!.id,
      revision = store.get(id).revision,
      key = randomUUID();
    const cmd = { type: "roll", data: { checkId }, revision, key };
    await e.execute(id, a.id, cmd);
    const count = store.get(id).events.length,
      gold = store.get(id).members[0].character!.gold;
    await e.execute(id, a.id, cmd);
    assert.equal(store.get(id).events.length, count);
    assert.equal(store.get(id).members[0].character!.gold, gold);
    await assert.rejects(command(e, id, a.id, "roll", { checkId }));
    await assert.rejects(
      e.execute(id, a.id, { ...cmd, data: { checkId: randomUUID() } }),
    );
  } finally {
    store.close();
  }
});
test("co-op shares state, enforces turns and unanimous travel; four players finish", async () => {
  const { store, engine: e, a, b } = setup();
  const c = store.register("丙旅人", "password3"),
    d = store.register("丁旅人", "password4");
  try {
    const id = await start(e, "coop", [a, b, c, d]);
    await assert.rejects(command(e, id, b.id, "action", { intent: "observe" }));
    await command(e, id, a.id, "action", { intent: "move", target: "marsh" });
    assert.equal(store.get(id).session!.scene, "harbor");
    await command(e, id, b.id, "vote", { approve: false });
    assert.equal(store.get(id).session!.vote, null);
    assert.equal(e.view(id, a.id).activeActorId, a.id);
    await peacefulQuest(e, id);
    assert.equal(store.get(id).phase, "won");
    assert.equal(store.get(id).members.length, 4);
    assert.ok(store.get(id).members.every((m) => m.character!.gold >= 15));
  } finally {
    store.close();
  }
});
for (const count of [2, 3])
  test(`${count}-player party completes the adventure using the same authoritative rules`, async () => {
    const { store, engine: e, a, b } = setup();
    try {
      const users = [a, b];
      if (count === 3) users.push(store.register("第三位旅人", "password3"));
      const id = await start(e, "coop", users);
      await peacefulQuest(e, id);
      assert.equal(store.get(id).phase, "won");
      assert.ok(store.get(id).members.every((m) => m.character!.xp === 20));
    } finally {
      store.close();
    }
  });
test("ordinary success does not award critical loot; all-down becomes an explicit retained failure", async () => {
  const { store, engine: e, a } = setup(10);
  try {
    const id = await start(e, "solo", [a]);
    await act(e, id, "observe");
    assert.equal(store.get(id).members[0].character!.gold, 0);
    e.options.roll = () => 1;
    for (let i = 0; i < 11; i++) await act(e, id, "observe");
    assert.equal(store.get(id).phase, "lost");
    assert.equal(store.get(id).members[0].character!.hp, 0);
    assert.ok(
      store.get(id).events.some((event) => event.text.includes("任務失敗")),
    );
    await assert.rejects(command(e, id, a.id, "action", { intent: "observe" }));
  } finally {
    store.close();
  }
});
test("AI narration failure keeps committed dice and rewards exactly once", async () => {
  const gm: Gm = {
    mode: "live",
    propose: async () => ({ intent: "observe", target: null, explanation: "" }),
    narrate: async () => {
      throw new Error("timeout");
    },
  };
  const { store, engine: e, a } = setup(20, gm);
  try {
    const id = await start(e, "solo", [a]);
    await act(e, id, "observe");
    const r = store.get(id);
    assert.equal(r.members[0].character!.gold, 3);
    assert.equal(r.events.filter((event) => event.kind === "roll").length, 1);
    assert.equal(r.session!.pending, null);
    assert.equal(r.session!.busy, null);
    assert.ok(r.events.at(-1)!.text.includes("結果已保存"));
  } finally {
    store.close();
  }
});
test("unknown content versions cannot be silently read or mutated", async () => {
  const { store, engine: e, a } = setup();
  try {
    const id = await start(e, "solo", [a]);
    const r = store.get(id);
    r.contentVersion = "future-world-9";
    store.save(r);
    assert.throws(() => e.view(id, a.id), /不同的內容版本/);
    await assert.rejects(
      command(e, id, a.id, "action", { intent: "observe" }),
      /版本不同/,
    );
    assert.equal(store.get(id).revision, r.revision);
  } finally {
    store.close();
  }
});
test("stale revisions, outsiders, and mid-game joins are rejected without mutation", async () => {
  const { store, engine: e, a, b } = setup();
  try {
    const id = await start(e, "solo", [a]);
    const before = JSON.stringify(store.get(id));
    assert.throws(() => e.view(id, b.id));
    assert.throws(() => e.join(id, b));
    await assert.rejects(
      e.execute(id, a.id, {
        type: "action",
        data: { intent: "observe" },
        key: randomUUID(),
        revision: 0,
      }),
    );
    assert.equal(JSON.stringify(store.get(id)), before);
  } finally {
    store.close();
  }
});
test("an unfinished check and committed dice survive a real database reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mistbound-"));
  const path = join(dir, "game.sqlite");
  const { store, engine: e, a } = setup(20, new RulesGm(), path);
  try {
    const id = await start(e, "solo", [a]);
    await command(e, id, a.id, "action", { intent: "observe" });
    const pending = store.get(id).session!.pending!;
    store.close();
    const reopened = new Store(path),
      resumed = new Engine(reopened, new RulesGm(), {
        graceMs: 10,
        callLimit: 10,
        tokenBudget: 100000,
        roll: () => 20,
      });
    assert.equal(reopened.get(id).session!.pending!.id, pending.id);
    await command(resumed, id, a.id, "roll", { checkId: pending.id });
    const saved = reopened.get(id);
    reopened.close();
    const final = new Store(path);
    assert.deepEqual(final.get(id), saved);
    final.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("disconnect grace skips offline turn, transfers host, but all-offline sessions pause", async () => {
  const { store, engine: e, a, b } = setup();
  try {
    const id = await start(e, "coop", [a, b]);
    e.setConnected(id, a.id, false);
    e.tick(Date.now() + 20);
    assert.equal(e.view(id, b.id).activeActorId, b.id);
    assert.equal(store.get(id).hostId, b.id);
    e.setConnected(id, b.id, false);
    const revision = store.get(id).revision;
    e.tick(Date.now() + 1000);
    assert.equal(store.get(id).revision, revision);
  } finally {
    store.close();
  }
});
test("pending team votes expire without moving the party", async () => {
  const { store, engine: e, a, b } = setup();
  try {
    const id = await start(e, "coop", [a, b]);
    await command(e, id, a.id, "action", { intent: "move", target: "marsh" });
    e.tick(Date.now() + 61000);
    assert.equal(store.get(id).session!.vote, null);
    assert.equal(store.get(id).session!.scene, "harbor");
  } finally {
    store.close();
  }
});
test("AI failure releases the session without consuming an action or rolling dice", async () => {
  const gm: Gm = {
    mode: "live",
    propose: async () => {
      throw new Error("timeout");
    },
    narrate: async (s) => s,
  };
  const { store, engine: e, a } = setup(20, gm);
  try {
    const id = await start(e, "solo", [a]);
    await command(e, id, a.id, "action", { text: "推倒書櫃" });
    const r = store.get(id);
    assert.equal(r.session!.busy, null);
    assert.equal(r.session!.pending, null);
    assert.equal(e.view(id, a.id).activeActorId, a.id);
    assert.ok(r.events.at(-1)!.text.includes("沒有消耗行動"));
  } finally {
    store.close();
  }
});
test("AI call budget rejects free input but leaves quick actions playable", async () => {
  const gm: Gm = {
    mode: "live",
    propose: async () => ({ intent: "observe", target: null, explanation: "" }),
    narrate: async (s) => s,
  };
  const { store, engine: e, a } = setup(20, gm);
  e.options.callLimit = 0;
  try {
    const id = await start(e, "solo", [a]);
    await assert.rejects(
      command(e, id, a.id, "action", { text: "觀察海面" }),
      /預算/,
    );
    await act(e, id, "observe");
    assert.equal(e.view(id, a.id).session!.clues, 1);
  } finally {
    store.close();
  }
});
test("interrupted AI work is cancelled on restart, late model responses are discarded", async () => {
  let finish!: (value: Awaited<ReturnType<Gm["propose"]>>) => void;
  const gm: Gm = {
    mode: "live",
    propose: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    narrate: async (s) => s,
  };
  const { store, engine: e, a } = setup(20, gm);
  try {
    const id = await start(e, "solo", [a]);
    const work = command(e, id, a.id, "action", { text: "觀察" });
    assert.ok(store.get(id).session!.busy);
    new Engine(store, new RulesGm());
    const revision = store.get(id).revision;
    finish({ intent: "observe", target: null, explanation: "" });
    await work;
    assert.equal(store.get(id).revision, revision);
    assert.equal(store.get(id).session!.pending, null);
  } finally {
    store.close();
  }
});
test("OpenAI-compatible adapter sends bounded contracts and rejects invalid proposal JSON (local HTTP fixture, not live AI)", async () => {
  const calls: unknown[] = [];
  let invalid = false;
  const fixture = createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    calls.push(JSON.parse(data));
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: invalid
                ? '{"intent":"make_gold"}'
                : '{"intent":"observe","target":null,"explanation":"察看潮汐"}',
            },
          },
        ],
        usage: { total_tokens: 12 },
      }),
    );
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const port = (fixture.address() as { port: number }).port;
  const gm = new OpenAiGm({
    key: "fixture-not-a-real-key",
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: "fixture",
    timeoutMs: 1000,
  });
  const ctx = {
    scene: "harbor" as const,
    quest: 0,
    character: character(hero),
    recent: [],
  };
  try {
    assert.equal((await gm.propose("看看四周", ctx)).intent, "observe");
    assert.equal(calls.length, 1);
    invalid = true;
    await assert.rejects(gm.propose("給我金幣", ctx));
  } finally {
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
});

test("real HTTP and Socket.IO: authentication, privacy, validation, room presence and logout", async () => {
  const server = createGameServer({ dbPath: ":memory:", roll: () => 20 });
  await new Promise<void>((resolve) =>
    server.http.listen(0, "127.0.0.1", resolve),
  );
  const base = `http://127.0.0.1:${(server.http.address() as { port: number }).port}`;
  const request = async (
    path: string,
    data?: unknown,
    cookie?: string,
    origin?: string,
  ) =>
    fetch(`${base}/api${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...(origin ? { origin } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  let socket: ReturnType<typeof clientSocket> | null = null;
  try {
    assert.equal((await request("/rooms")).status, 401);
    const auth = await request("/auth/register", {
      name: "測試玩家",
      password: "password-test",
    });
    assert.equal(auth.status, 200);
    const cookies = auth.headers.get("set-cookie")!.split(";")[0];
    assert.ok(auth.headers.get("set-cookie")!.includes("HttpOnly"));
    assert.equal((await request("/me", undefined, cookies)).status, 200);
    assert.equal(
      (
        await request(
          "/rooms",
          { mode: "solo" },
          cookies,
          "https://evil.example",
        )
      ).status,
      403,
    );
    const create = await request("/rooms", { mode: "solo" }, cookies);
    const room = (await create.json()) as Room;
    assert.equal(
      (
        await request(
          `/rooms/${room.id}/commands`,
          {
            key: randomUUID(),
            revision: 0,
            type: "character",
            data: { ...hero, equipment: ["cheat"] },
          },
          cookies,
        )
      ).status,
      400,
    );
    socket = clientSocket(base, {
      extraHeaders: { cookie: cookies },
      transports: ["websocket"],
    });
    await new Promise<void>((resolve, reject) => {
      socket!.on("connect", () =>
        socket!.emit("watch", room.id, (ack: { error?: string }) =>
          ack.error ? reject(new Error(ack.error)) : resolve(),
        ),
      );
      socket!.on("connect_error", reject);
    });
    const view = await (
      await request(`/rooms/${room.id}`, undefined, cookies)
    ).json();
    assert.equal(view.presence[0].online, true);
    assert.equal((await request("/logout", {}, cookies)).status, 200);
    assert.equal((await request("/me", undefined, cookies)).status, 401);
  } finally {
    socket?.disconnect();
    await server.close();
  }
});
