import { chromium, type Page } from "@playwright/test";
import { createGameServer } from "../server/app.js";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { RulesGm } from "../server/gm.js";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";

mkdirSync("acceptance/evidence", { recursive: true });
const results: any[] = [];
const stamp = Date.now();
const dbPath = `acceptance/evidence/run-${stamp}.sqlite`;
let server = createGameServer({ dbPath, graceMs: 600 });
await new Promise<void>((resolve) =>
  server.http.listen(3201, "127.0.0.1", resolve),
);
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const base = "http://127.0.0.1:3201";
async function check(name: string, fn: () => Promise<any>) {
  try {
    const detail = await fn();
    results.push({ name, status: "PASS", detail });
  } catch (e) {
    results.push({ name, status: "FAIL", error: String(e) });
    for (const [i, c] of browser.contexts().entries()) {
      try {
        await c
          .pages()[0]
          ?.screenshot({
            path: `acceptance/evidence/failure-${results.length}-${i}.png`,
            fullPage: true,
          });
      } catch {}
    }
  }
  writeFileSync(
    "acceptance/evidence/results.json",
    JSON.stringify(results, null, 2),
  );
}
async function account(label: string) {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByLabel("旅人名稱").fill(`驗收${label}${stamp}`);
  await page.getByLabel("密碼", { exact: true }).fill("acceptance-fake-2026");
  await page.getByRole("button", { name: "建立帳號，開始冒險" }).click();
  await page.getByRole("button", { name: "單人啟程" }).waitFor();
  return { context, page };
}
async function view(p: Page) {
  const id = p.url().split("/room/")[1];
  const res = await p.request.get(`/api/rooms/${id}`);
  return res.json();
}
async function char(p: Page, n: string) {
  await p.getByLabel("角色名字").fill(n);
  await p.getByRole("button", { name: "完成角色建立" }).click();
  await p.getByRole("button", { name: "我準備好了" }).click();
  await p.getByRole("button", { name: "取消準備" }).waitFor();
}
async function dice(p: Page, intent: string) {
  await p.getByRole("button", { name: intent, exact: true }).click();
  await p.getByRole("button", { name: "擲出 D20" }).click();
  await p
    .getByRole("button", { name: "擲出 D20" })
    .waitFor({ state: "hidden" });
}
async function until(p: Page, fn: (v: any) => boolean, intent: string) {
  for (let i = 0; i < 15; i++) {
    const v = await view(p);
    if (fn(v)) return;
    if (v.members[0].character.hp < 7 && v.members[0].character.potions)
      await p.getByRole("button", { name: "使用藥水", exact: true }).click();
    await dice(p, intent);
  }
  throw Error("excessive retries");
}
const solo = await account("獨行");
await check(
  "UI single-player actual random-dice complete quest and sequel",
  async () => {
    const p = solo.page;
    await p.getByRole("button", { name: "單人啟程" }).click();
    await char(p, "獨行觀察者");
    await p.getByRole("button", { name: "開始冒險" }).click();
    await p.getByRole("button", { name: "觀察四周", exact: true }).waitFor();
    await p.getByLabel("自由行動", { exact: true }).fill("我想要飛上月球");
    await p.getByRole("button", { name: "送出自由行動" }).click();
    await p
      .getByText("目前是規則試玩模式，請選擇快捷行動", { exact: false })
      .waitFor();
    let v = await view(p);
    assert.equal(v.session.pending, null);
    assert.equal(v.aiMode, "rules");
    await until(p, (v) => v.session.clues >= 1, "交談");
    await p.getByRole("button", { name: /低語濕地/ }).click();
    await until(p, (v) => v.session.clues >= 2, "調查／操作");
    await p.getByRole("button", { name: /無光燈塔/ }).click();
    await until(p, (v) => v.session.objectiveReady, "交談");
    await until(p, (v) => v.phase === "won", "調查／操作");
    v = await view(p);
    const first = {
      phase: v.phase,
      gold: v.members[0].character.gold,
      level: v.members[0].character.level,
      events: v.events.length,
      rolls: v.events
        .filter((e: any) => e.kind === "roll")
        .map((e: any) => e.text),
    };
    await p.screenshot({
      path: "acceptance/evidence/solo-won-desktop.png",
      fullPage: true,
    });
    await p.getByRole("button", { name: "接續第二章" }).click();
    v = await view(p);
    assert.equal(v.session.quest, 1);
    assert.equal(v.members[0].character.gold, first.gold);
    assert.equal(v.members[0].character.level, 2);
    return first;
  },
);
await check(
  "UI saved pending check survives real server restart, dice receipt cannot reroll",
  async () => {
    const p = solo.page;
    await p.getByRole("button", { name: "觀察四周", exact: true }).click();
    let v = await view(p);
    const pendingId = v.session.pending.id;
    const port = 3201;
    await server.close();
    server = createGameServer({ dbPath, graceMs: 600 });
    await new Promise<void>((resolve) =>
      server.http.listen(port, "127.0.0.1", resolve),
    );
    await p.reload();
    await p.getByRole("button", { name: "擲出 D20" }).waitFor();
    v = await view(p);
    assert.equal(v.session.pending.id, pendingId);
    await p.getByRole("button", { name: "擲出 D20" }).click();
    await p
      .getByRole("button", { name: "擲出 D20" })
      .waitFor({ state: "hidden" });
    v = await view(p);
    const res = await p.request.post(`/api/rooms/${v.id}/commands`, {
      data: {
        key: randomUUID(),
        revision: v.revision,
        type: "roll",
        data: { checkId: pendingId },
      },
    });
    assert.equal(res.status(), 409);
    return {
      pendingIdPreserved: true,
      oldCheckReplayStatus: res.status(),
      revision: v.revision,
    };
  },
);
await check(
  "UI mobile pages usable at 360 x 800, free input and map navigation accessible",
  async () => {
    const p = solo.page;
    await p.setViewportSize({ width: 360, height: 800 });
    await p.getByRole("button", { name: "場景地圖", exact: true }).click();
    await p.getByRole("heading", { name: "暮潮港", exact: true }).waitFor();
    await p.screenshot({
      path: "acceptance/evidence/mobile-map.png",
      fullPage: true,
    });
    await p.getByRole("button", { name: "角色背包", exact: true }).click();
    await p.getByRole("heading", { name: "獨行觀察者", exact: true }).waitFor();
    await p.getByRole("button", { name: "故事與行動", exact: true }).click();
    await p.getByLabel("自由行動", { exact: true }).fill("看看四周");
    await p.getByRole("button", { name: "送出自由行動" }).click();
    await p.getByRole("button", { name: "擲出 D20" }).waitFor();
    await p.screenshot({
      path: "acceptance/evidence/mobile-pending.png",
      fullPage: true,
    });
    const size = await p.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
    }));
    assert.ok(size.scrollWidth <= size.innerWidth);
    return size;
  },
);
const a = await account("合作甲"),
  b = await account("合作乙");
await check(
  "UI two-party invite, travel consensus, denied wrong turn, chat, disconnect and host transfer",
  async () => {
    await a.page.getByRole("button", { name: "建立合作房間" }).click();
    await a.page.getByRole("heading", { name: "在出發之前" }).waitFor();
    const url = a.page.url();
    await b.page.goto(url);
    await char(a.page, "甲守衛");
    await char(b.page, "乙守衛");
    await a.page.getByRole("button", { name: "開始冒險" }).click();
    await a.page
      .getByRole("heading", { name: "重燃霧海之燈", exact: true })
      .waitFor();
    await a.page.getByRole("button", { name: /低語濕地/ }).click();
    let v = await view(a.page);
    assert.equal(v.session.scene, "harbor");
    assert.equal(v.session.vote.approvals.length, 1);
    await b.page.getByRole("button", { name: "取消", exact: true }).click();
    await a.page.getByRole("button", { name: /低語濕地/ }).click();
    await b.page.getByRole("button", { name: "同意移動" }).click();
    await b.page.getByRole("heading", { name: /低語濕地/ }).waitFor();
    v = await view(b.page);
    const wrong = await a.page.request.post(`/api/rooms/${v.id}/commands`, {
      data: {
        key: randomUUID(),
        revision: v.revision,
        type: "action",
        data: { intent: "observe" },
      },
    });
    assert.equal(wrong.status(), 403);
    await b.page.getByLabel("聊天訊息").fill("驗收：先調查刻文");
    await b.page.getByRole("button", { name: "送出訊息" }).click();
    await a.page.getByText("驗收：先調查刻文", { exact: false }).waitFor();
    const bId = v.members[1].userId;
    await a.page.goto("about:blank");
    await new Promise((r) => setTimeout(r, 1800));
    v = await view(b.page);
    assert.equal(v.hostId, bId);
    await a.page.goto(url);
    await a.page.getByRole("heading", { name: /低語濕地/ }).waitFor();
    await b.page.screenshot({
      path: "acceptance/evidence/cooperative-reconnect.png",
      fullPage: true,
    });
    return {
      wrongTurnHttp: wrong.status(),
      scene: v.session.scene,
      hostTransferred: true,
      presenceAfterReconnect: (await view(a.page)).presence,
    };
  },
);
await browser.close();
await server.close();
// Deterministic rule probes: independent reproducible boundary checks, not live random play.
const store = new Store(":memory:");
let roll = 20;
const e = new Engine(store, new RulesGm(), {
  graceMs: 10,
  callLimit: 10,
  tokenBudget: 100000,
  roll: () => roll,
});
const hero = {
  name: "邊界旅人",
  race: "human",
  job: "guardian",
  stats: { strength: 2, agility: 2, insight: 2 },
};
async function cmd(id: string, u: string, type: string, data: any = {}) {
  await e.execute(id, u, {
    key: randomUUID(),
    revision: store.get(id).revision,
    type,
    data,
  });
}
async function start(count = 1) {
  const users = Array.from({ length: count }, (_, i) =>
    store.register(`probe${randomUUID().slice(0, 6)}`, "fixture-password"),
  );
  const r = e.create(users[0], count === 1 ? "solo" : "coop");
  for (const u of users) {
    if (u !== users[0]) e.join(r.id, u);
    e.setConnected(r.id, u.id, true);
    await cmd(r.id, u.id, "character", hero);
    await cmd(r.id, u.id, "ready");
  }
  await cmd(r.id, users[0].id, "start");
  return { id: r.id, u: users[0].id, users };
}
async function act(id: string, u: string, intent: string) {
  await cmd(id, u, "action", { intent });
  const p = store.get(id).session!.pending;
  if (p) await cmd(id, u, "roll", { checkId: p.id });
}
await check(
  "BUG probe: confusion should last until next check, but defend clears it",
  async () => {
    const { id, u } = await start();
    roll = 1;
    await act(id, u, "observe");
    const afterFailure = store.get(id).members[0].character!;
    assert.equal(afterFailure.confused, 1);
    await act(id, u, "defend");
    const afterDefend = store.get(id).members[0].character!;
    roll = 10;
    await cmd(id, u, "action", { intent: "observe" });
    const p = store.get(id).session!.pending!;
    // Log the contradictory behavior without redefining the expected rule.
    assert.equal(afterDefend.confused, 0);
    assert.equal(p.modifier, 3);
    return {
      expected: "next check modifier = 1 (insight 2 + human 1 - confusion 2)",
      actualModifier: p.modifier,
      hp: afterFailure.hp,
      confusedAfterDefend: afterDefend.confused,
      defectConfirmed: true,
    };
  },
);
await check(
  "DESIGN RISK probe: critical-success observe repeatedly awards loot in exhausted harbor",
  async () => {
    const { id, u } = await start();
    roll = 20;
    for (let i = 0; i < 12; i++) await act(id, u, "observe");
    const r = store.get(id);
    assert.equal(r.members[0].character!.gold, 36);
    return {
      observations: 12,
      uniqueClues: r.session!.flags.filter((f) => f.startsWith("clue:")).length,
      gold: r.members[0].character!.gold,
      designRiskConfirmed: true,
    };
  },
);
store.close();
writeFileSync(
  "acceptance/evidence/results.json",
  JSON.stringify(results, null, 2),
);
console.log(JSON.stringify(results, null, 2));
