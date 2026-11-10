import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { RulesGm } from "../server/gm.js";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
const st = new Store(":memory:");
const e = new Engine(st, new RulesGm(), {
  graceMs: 60000,
  callLimit: 100,
  tokenBudget: 100000,
  roll: () => 20,
});
const us = ["甲", "乙", "丙"].map((name, i) =>
  st.register("序" + name, "fixture-password"),
);
const room = e.create(us[0], "coop");
const id = room.id;
async function c(u: string, type: string, data: any = {}) {
  await e.execute(id, u, {
    key: randomUUID(),
    revision: st.get(id).revision,
    type,
    data,
  });
}
for (let i = 0; i < 3; i++) {
  if (i) e.join(id, us[i]);
  e.setConnected(id, us[i].id, true);
  await c(us[i].id, "character", {
    name: us[i].name,
    race: "human",
    job: "guardian",
    stats: { strength: 2, agility: 2, insight: 2 },
  });
  await c(us[i].id, "ready");
}
await c(us[0].id, "start");
async function action(intent: string, target?: string) {
  let r = st.get(id);
  const u = r.session!.turnOrder[r.session!.turnIndex];
  await c(u, "action", { intent, ...(target ? { target } : {}) });
  r = st.get(id);
  if (r.session!.pending)
    await c(u, "roll", { checkId: r.session!.pending.id });
  r = st.get(id);
  if (r.session!.vote)
    for (const a of r.session!.vote.required.filter(
      (a) => !r.session!.vote!.approvals.includes(a),
    ))
      await c(a, "vote", { approve: true });
}
await action("talk");
await action("move", "marsh");
await action("observe");
await action("move", "tower");
await action("attack");
await action("skill");
await action("attack");
await action("interact");
const won = st.get(id);
await c(us[0].id, "next");
const next = st.get(id);
const names = (ids: string[]) =>
  ids.map((id) => us.find((u) => u.id === id)!.name);
const result = {
  firstWon: won.phase,
  initialJoinOrder: us.map((u) => u.name),
  afterCombatOrder: names(won.session!.turnOrder),
  secondChapterOrder: names(next.session!.turnOrder),
  secondChapterActor: us.find(
    (u) => u.id === e.view(id, us[0].id).activeActorId,
  )!.name,
};
writeFileSync(
  "acceptance/evidence/order-probe.json",
  JSON.stringify(result, null, 2),
);
console.log(result);
st.close();
