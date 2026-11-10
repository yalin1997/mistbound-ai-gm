import { randomInt, randomUUID } from "node:crypto";
import {
  VERSION,
  intentNames,
  jobs,
  objectives,
  questNames,
  races,
  scenes,
} from "../shared/content.js";
import type {
  ActionInput,
  Character,
  Intent,
  Member,
  Outcome,
  Presence,
  Room,
  RoomView,
  SceneId,
  Session,
} from "../shared/types.js";
import { GameError, Store } from "./store.js";
import { toAction, type Gm, type GmContext } from "./gm.js";

export function outcome(die: number, modifier: number, dc: number): Outcome {
  if (!Number.isInteger(die) || die < 1 || die > 20)
    throw new Error("Invalid D20");
  return die === 1
    ? "critical_failure"
    : die === 20
      ? "critical_success"
      : die + modifier >= dc
        ? "success"
        : "failure";
}
export function character(
  input: Pick<Character, "name" | "race" | "job" | "stats">,
): Character {
  if (!races[input.race] || !jobs[input.job])
    throw new GameError(400, "不支援的種族或職業");
  const values = Object.values(input.stats);
  if (
    values.length !== 3 ||
    values.some((n) => !Number.isInteger(n) || n < 0 || n > 4) ||
    values.reduce((a, b) => a + b, 0) !== 6
  )
    throw new GameError(400, "三項屬性需分配共 6 點，各項 0–4 點");
  const maxHp =
    18 + (input.job === "guardian" ? 4 : 0) + (input.race === "dwarf" ? 2 : 0);
  return {
    ...input,
    maxHp,
    hp: maxHp,
    potions: 2,
    focus: 3,
    gold: 0,
    xp: 0,
    level: 1,
    equipment: [...jobs[input.job].equipment],
    confused: 0,
  };
}
export function event(
  room: Room,
  kind: Room["events"][number]["kind"],
  text: string,
  userId?: string,
) {
  room.events.push({
    seq: (room.events.at(-1)?.seq ?? 0) + 1,
    at: new Date().toISOString(),
    kind,
    text,
    ...(userId ? { userId } : {}),
  });
}
const sessionOf = (room: Room): Session => {
  if (!room.session) throw new GameError(409, "冒險尚未開始");
  return room.session;
};
const memberOf = (room: Room, id: string): Member => {
  const m = room.members.find((m) => m.userId === id);
  if (!m) throw new GameError(403, "你不是這個房間的成員");
  return m;
};
const active = (room: Room) =>
  room.session?.turnOrder[room.session.turnIndex] ?? null;
export type Command = {
  type: string;
  data: Record<string, unknown>;
  key: string;
  revision: number;
};

export class Engine {
  connections = new Map<string, number>();
  offlineSince = new Map<string, number>();
  onChange: (id: string) => void = () => {};
  constructor(
    public store: Store,
    public gm: Gm,
    public options = {
      graceMs: 60000,
      callLimit: 100,
      tokenBudget: 300000,
      roll: () => randomInt(1, 21),
    },
  ) {
    // Recover interrupted external work. Committed checks and dice remain intact.
    for (const room of store.rooms()) {
      for (const member of room.members)
        this.offlineSince.set(`${room.id}:${member.userId}`, Date.now());
      if (room.session?.busy) {
        room.session.busy = null;
        room.revision++;
        event(
          room,
          "system",
          "主機已恢復。未完成的 AI 敘事已取消；已確認的遊戲結果保留，可重新選擇行動。",
        );
        store.save(room);
      }
    }
  }
  create(user: { id: string; name: string }, mode: "solo" | "coop") {
    if (
      this.store
        .rooms()
        .filter((r) => r.members.some((m) => m.userId === user.id)).length >= 30
    )
      throw new GameError(429, "最多保留 30 個冒險房間");
    const room: Room = {
      id: randomUUID().replaceAll("-", "").slice(0, 12),
      mode,
      hostId: user.id,
      members: [
        {
          userId: user.id,
          displayName: user.name,
          character: null,
          ready: false,
        },
      ],
      phase: "lobby",
      revision: 0,
      contentVersion: VERSION,
      session: null,
      events: [],
      createdAt: new Date().toISOString(),
    };
    event(
      room,
      "gm",
      "霧海之上，一盞燈已熄滅。建立你的角色，讓旅程從這裡開始。",
    );
    this.store.save(room);
    this.offlineSince.set(`${room.id}:${user.id}`, Date.now());
    return room;
  }
  join(id: string, user: { id: string; name: string }) {
    return this.store.transaction(() => {
      const room = this.store.get(id);
      if (room.members.some((m) => m.userId === user.id)) return room;
      if (
        room.mode === "solo" ||
        room.phase !== "lobby" ||
        room.members.length >= 4
      )
        throw new GameError(409, "房間未開放加入（僅多人準備室，最多 4 人）");
      room.members.push({
        userId: user.id,
        displayName: user.name,
        character: null,
        ready: false,
      });
      event(room, "system", `${user.name} 加入了冒險。`);
      room.revision++;
      this.store.save(room);
      this.offlineSince.set(`${id}:${user.id}`, Date.now());
      this.onChange(id);
      return room;
    });
  }
  presence(room: Room): Presence[] {
    return room.members.map((m) => ({
      userId: m.userId,
      online: (this.connections.get(`${room.id}:${m.userId}`) ?? 0) > 0,
      offlineSince: this.offlineSince.get(`${room.id}:${m.userId}`) ?? null,
    }));
  }
  view(id: string, userId: string): RoomView {
    const room = this.store.get(id);
    memberOf(room, userId);
    if (room.contentVersion !== VERSION)
      throw new GameError(
        409,
        "此存檔使用不同的內容版本，請保留資料並以原版本開啟",
      );
    const { session, ...rest } = room;
    return {
      ...rest,
      session: session
        ? (({ flags, aiTokensReserved: _, ...s }) => ({
            ...s,
            clues: flags.filter((f) => f.startsWith("clue:")).length,
            objectiveReady: flags.includes("guard-cleared"),
          }))(session)
        : null,
      activeActorId: active(room),
      presence: this.presence(room),
      chat: this.store.chat(id),
      aiMode: this.gm.mode,
    };
  }
  setConnected(id: string, userId: string, connected: boolean) {
    const room = this.store.get(id);
    memberOf(room, userId);
    const key = `${id}:${userId}`,
      count = Math.max(
        0,
        (this.connections.get(key) ?? 0) + (connected ? 1 : -1),
      );
    this.connections.set(key, count);
    if (count > 0) this.offlineSince.delete(key);
    else this.offlineSince.set(key, Date.now());
    this.onChange(id);
  }
  context(room: Room, userId: string): GmContext {
    return {
      roomId: room.id,
      scene: sessionOf(room).scene,
      quest: sessionOf(room).quest,
      character: memberOf(room, userId).character!,
      recent: room.events.slice(-6).map((e) => e.text.slice(0, 500)),
    };
  }
  requireTurn(room: Room, userId: string) {
    const s = sessionOf(room);
    if (room.phase !== "playing") throw new GameError(409, "目前不在遊玩階段");
    if (s.busy || s.vote) throw new GameError(409, "請等待 GM 或隊伍決策完成");
    if (active(room) !== userId) throw new GameError(403, "還沒輪到你的行動");
    if (memberOf(room, userId).character!.hp <= 0)
      throw new GameError(409, "角色已倒下");
  }
  async execute(id: string, userId: string, command: Command) {
    const fingerprint = JSON.stringify({
      type: command.type,
      data: command.data,
    });
    let external: "propose" | "narrate" | null = null;
    let externalText = "",
      workId = "";
    this.store.transaction(() => {
      const room = this.store.get(id);
      memberOf(room, userId);
      if (room.contentVersion !== VERSION)
        throw new GameError(409, "內容版本不同，不能以新版規則改寫此存檔");
      if (this.store.receipt(id, userId, command.key, fingerprint)) return;
      if (room.revision !== command.revision)
        throw new GameError(409, "冒險狀態已更新，請確認最新畫面再操作");
      const before = room.events.length;
      if (
        command.type === "action" &&
        typeof command.data.text === "string" &&
        command.data.text.trim()
      ) {
        this.requireTurn(room, userId);
        if (sessionOf(room).pending)
          throw new GameError(409, "請先完成等待中的檢定");
        external = "propose";
        externalText = command.data.text.trim();
        this.reserveAi(room, userId, "propose");
        workId = randomUUID();
        sessionOf(room).busy = {
          id: workId,
          actorId: userId,
          startedAt: Date.now(),
        };
        event(
          room,
          "action",
          `${memberOf(room, userId).character!.name}：${externalText}`,
          userId,
        );
      } else {
        this.apply(room, userId, command.type, command.data);
        if (
          this.gm.mode === "live" &&
          command.type === "roll" &&
          room.events.length > before &&
          this.canAi(room, userId)
        ) {
          external = "narrate";
          externalText = room.events
            .slice(before)
            .map((e) => e.text)
            .join("\n");
          this.reserveAi(room, userId, "narrate");
          workId = randomUUID();
          sessionOf(room).busy = {
            id: workId,
            actorId: userId,
            startedAt: Date.now(),
          };
        }
      }
      room.revision++;
      this.store.remember(id, userId, command.key, fingerprint);
      this.store.save(room);
    });
    this.onChange(id);
    if (!external) return;
    const context = this.context(this.store.get(id), userId);
    try {
      if (external === "propose") {
        const proposal = await this.gm.propose(externalText, context);
        this.finishWork(id, workId, (room) => {
          if (proposal.intent === "clarify" || proposal.intent === "reject")
            event(room, "gm", proposal.explanation);
          else {
            try {
              this.action(room, userId, toAction(proposal));
            } catch (error) {
              if (error instanceof GameError)
                event(room, "gm", `${error.message}。你可以改用快捷選項。`);
              else throw error;
            }
          }
        });
      } else {
        const prose = await this.gm.narrate(externalText, context);
        this.finishWork(id, workId, (room) =>
          event(room, "gm", `旁白｜${prose}`),
        );
      }
    } catch {
      this.finishWork(id, workId, (room) =>
        event(
          room,
          "system",
          external === "narrate"
            ? "AI 旁白暫時無法使用，以上規則結果已保存。"
            : "AI 未能解析這次行動，沒有消耗行動。請重試或選擇快捷行動。",
        ),
      );
    }
  }
  canAi(room: Room, userId: string) {
    const s = sessionOf(room);
    // UTF-8 bytes conservatively bound input tokens. Additional reserve covers
    // fixed prompts, player input, world metadata and the output token limit.
    const estimate =
      Buffer.byteLength(JSON.stringify(this.context(room, userId))) + 8000;
    return (
      s.aiCalls < this.options.callLimit &&
      s.aiTokensReserved + estimate <= this.options.tokenBudget
    );
  }
  reserveAi(room: Room, userId: string, kind: string) {
    if (this.gm.mode === "rules") return;
    if (!this.canAi(room, userId))
      throw new GameError(
        429,
        "本場 AI 預算已達上限，仍可使用快捷行動並保存進度",
      );
    const s = sessionOf(room);
    s.aiCalls++;
    s.aiTokensReserved +=
      Buffer.byteLength(JSON.stringify(this.context(room, userId))) + 8000;
    console.info(
      JSON.stringify({
        kind: "ai-request",
        roomId: room.id,
        task: kind,
        request: s.aiCalls,
      }),
    );
  }
  finishWork(id: string, workId: string, fn: (room: Room) => void) {
    this.store.transaction(() => {
      const room = this.store.get(id);
      if (room.session?.busy?.id !== workId) return;
      room.session.busy = null;
      fn(room);
      room.revision++;
      this.store.save(room);
    });
    this.onChange(id);
  }
  apply(
    room: Room,
    userId: string,
    type: string,
    data: Record<string, unknown>,
  ) {
    const member = memberOf(room, userId);
    if (type === "character") {
      if (room.phase !== "lobby")
        throw new GameError(409, "開始後不能重新建角");
      member.character = character(
        data as unknown as Parameters<typeof character>[0],
      );
      member.ready = false;
    } else if (type === "ready") {
      if (room.phase !== "lobby" || !member.character)
        throw new GameError(409, "請先建立角色");
      member.ready = !member.ready;
    } else if (type === "start") {
      if (room.hostId !== userId || room.phase !== "lobby")
        throw new GameError(403, "只有房主能開始冒險");
      if (
        room.members.some((m) => !m.ready || !m.character) ||
        (room.mode === "coop" && room.members.length < 2)
      )
        throw new GameError(409, "合作模式需要至少兩人，且全員需準備完成");
      room.phase = "playing";
      room.session = {
        quest: 0,
        scene: "harbor",
        visited: ["harbor"],
        flags: [],
        enemyHp: 10 + room.members.length * 4,
        enemyMaxHp: 10 + room.members.length * 4,
        combat: false,
        turnOrder: room.members.map((m) => m.userId),
        turnIndex: 0,
        pending: null,
        vote: null,
        busy: null,
        aiCalls: 0,
        aiTokensReserved: 0,
      };
      event(
        room,
        "gm",
        `第一章｜${questNames[0]}。${objectives[0]} ${scenes.harbor.description}`,
      );
    } else if (type === "action") {
      this.requireTurn(room, userId);
      if (sessionOf(room).pending)
        throw new GameError(409, "請先完成等待中的檢定");
      this.action(room, userId, data as ActionInput);
    } else if (type === "roll") {
      this.requireTurn(room, userId);
      const s = sessionOf(room),
        p = s.pending;
      if (!p || p.actorId !== userId || p.id !== data.checkId)
        throw new GameError(409, "這次檢定已結算或不存在");
      s.pending = null;
      const die = this.options.roll(),
        result = outcome(die, p.modifier, p.dc);
      const labels: Record<Outcome, string> = {
        critical_failure: "大失敗",
        failure: "失敗",
        success: "成功",
        critical_success: "大成功",
      };
      event(
        room,
        "roll",
        `${member.character!.name} 的${p.label}：D20 ${die} ＋ ${p.modifier} ／ DC ${p.dc} → ${labels[result]}`,
        userId,
      );
      this.resolve(room, userId, p.intent, result);
      this.endTurn(room, userId);
    } else if (type === "vote") {
      const s = sessionOf(room),
        v = s.vote;
      if (
        !v ||
        s.busy ||
        room.phase !== "playing" ||
        !v.required.includes(userId)
      )
        throw new GameError(409, "目前沒有需要你確認的決策");
      if (data.approve !== true || Date.now() > v.expiresAt) {
        s.vote = null;
        event(room, "system", "隊伍取消了移動，保留在原場景。");
      } else {
        if (!v.approvals.includes(userId)) v.approvals.push(userId);
        if (v.required.every((id) => v.approvals.includes(id)))
          this.move(room, v.target, v.initiator);
      }
    } else if (type === "next") {
      if (
        room.hostId !== userId ||
        room.phase !== "won" ||
        sessionOf(room).quest !== 0 ||
        sessionOf(room).busy
      )
        throw new GameError(409, "目前不能接續任務");
      const s = sessionOf(room);
      s.quest = 1;
      s.scene = "harbor";
      s.flags = [];
      s.visited = ["harbor"];
      s.combat = false;
      s.enemyHp = s.enemyMaxHp;
      s.pending = null;
      s.vote = null;
      s.turnIndex = 0;
      room.phase = "playing";
      room.members.forEach((m) => {
        m.character!.hp = m.character!.maxHp;
        m.character!.focus = 3;
        m.character!.potions = Math.max(2, m.character!.potions);
        m.character!.confused = 0;
      });
      event(
        room,
        "gm",
        `第二章｜${questNames[1]}。船長帶來新的消息：失落的航路石正在呼喚。${objectives[1]} 既有角色、裝備、金幣與履歷保留。`,
      );
    } else if (type === "claim-host") {
      if (this.presence(room).some((p) => p.userId === room.hostId && p.online))
        throw new GameError(409, "房主仍在線");
      const first = room.members.find((m) =>
        this.presence(room).some((p) => p.userId === m.userId && p.online),
      );
      if (first?.userId !== userId)
        throw new GameError(403, "由最早加入且在線的成員接任");
      room.hostId = userId;
      event(room, "system", `${member.displayName} 接任房間管理。`);
    } else {
      throw new GameError(400, "不支援的操作");
    }
  }
  action(room: Room, userId: string, input: ActionInput) {
    const s = sessionOf(room),
      c = memberOf(room, userId).character!,
      intent = input.intent;
    if (!intent || !intentNames[intent])
      throw new GameError(400, "請選擇有效行動");
    if (intent === "move") {
      const target = input.target;
      if (!target || !scenes[target] || target === s.scene)
        throw new GameError(400, "請選擇其他區域");
      if (s.combat) throw new GameError(409, "戰鬥中不能離開區域");
      const order = ["harbor", "marsh", "tower"];
      if (Math.abs(order.indexOf(target) - order.indexOf(s.scene)) !== 1)
        throw new GameError(400, "只能前往相鄰區域");
      const required = this.presence(room)
        .filter((p) => p.online)
        .map((p) => p.userId);
      if (!required.includes(userId)) required.push(userId);
      if (required.length === 1) this.move(room, target, userId);
      else {
        s.vote = {
          target,
          initiator: userId,
          required,
          approvals: [userId],
          expiresAt: Date.now() + 60000,
        };
        event(
          room,
          "system",
          `${c.name} 提議前往${scenes[target].name}，等待在線隊友確認。`,
        );
      }
      return;
    }
    if (intent === "pass" || intent === "defend") {
      event(
        room,
        "action",
        `${c.name}${intent === "defend" ? "舉起防具，等待下一個機會。" : "讓出這次行動。"}`,
        userId,
      );
      this.endTurn(room, userId, intent === "defend");
      return;
    }
    if (intent === "heal") {
      if (c.potions <= 0) throw new GameError(409, "沒有藥水了");
      if (c.hp === c.maxHp)
        throw new GameError(409, "生命已滿，不需要使用藥水");
      c.potions--;
      const amount = Math.min(8, c.maxHp - c.hp);
      c.hp += amount;
      event(
        room,
        "action",
        `${c.name} 使用藥水，回復 ${amount} 生命。`,
        userId,
      );
      this.endTurn(room, userId);
      return;
    }
    if (
      (intent === "attack" || intent === "skill") &&
      (s.scene !== "tower" || s.flags.includes("guard-cleared"))
    )
      throw new GameError(409, "目前沒有可攻擊的敵人");
    if (intent === "skill" && c.focus <= 0)
      throw new GameError(409, "專注不足，請改用普通攻擊");
    if (intent === "talk" && s.scene === "marsh")
      throw new GameError(409, "濕地無人回應，可以觀察或調查刻文");
    if ((intent === "attack" || intent === "skill") && !s.combat) {
      s.combat = true;
      // Initiative is deterministic and rules-owned; current actor keeps first action.
      const rest = room.members
        .filter((m) => m.userId !== userId)
        .sort(
          (a, b) => b.character!.stats.agility - a.character!.stats.agility,
        );
      s.turnOrder = [userId, ...rest.map((m) => m.userId)];
      s.turnIndex = 0;
      event(
        room,
        "system",
        "潮汐守衛拔出鏽蝕的長刃，戰鬥開始。當前行動者先手，其餘依敏捷排序。",
      );
    }
    const stat =
      intent === "attack" || intent === "skill"
        ? jobs[c.job].stat
        : intent === "interact"
          ? "agility"
          : "insight";
    const modifier =
      c.stats[stat] +
      (races[c.race].bonus === stat ? 1 : 0) -
      (c.confused > 0 ? 2 : 0);
    s.pending = {
      id: randomUUID(),
      actorId: userId,
      intent,
      stat,
      dc: intent === "talk" && s.scene === "tower" ? 12 : 10,
      modifier,
      label: intentNames[intent],
    };
    event(
      room,
      "system",
      `${c.name} 準備${intentNames[intent]}：DC ${s.pending.dc}，加值 ${modifier}。等待玩家擲骰。`,
      userId,
    );
  }
  move(room: Room, target: SceneId, userId: string) {
    const s = sessionOf(room);
    s.scene = target;
    s.vote = null;
    if (!s.visited.includes(target)) s.visited.push(target);
    event(
      room,
      "gm",
      `隊伍抵達${scenes[target].name}。${scenes[target].description}`,
    );
    this.endTurn(room, userId);
  }
  addClue(room: Room, source: string) {
    const s = sessionOf(room),
      key = `clue:${source}`;
    if (s.flags.includes(key)) {
      event(room, "gm", "這裡的線索已經記在旅程紀錄中。");
      return;
    }
    s.flags.push(key);
    event(
      room,
      "gm",
      source === "harbor"
        ? s.quest === 0
          ? "老船長的潮汐圖揭示了守衛的誓言：守護航路，而非阻擋旅人。取得港口線索。"
          : "船長交出守燈人的新信件，指出航路石遺失的音節。取得港口回聲。"
        : s.quest === 0
          ? "你辨認出蘆葦旁的符文，記下重燃燈塔的潮汐節律。取得濕地線索。"
          : "古老刻文對上了信中的音節，最後一段回聲浮出水面。取得濕地回聲。",
    );
  }
  resolve(room: Room, userId: string, intent: Intent, result: Outcome) {
    const s = sessionOf(room),
      c = memberOf(room, userId).character!;
    const success = result === "success" || result === "critical_success",
      crit = result === "critical_success";
    if (intent === "skill") c.focus--;
    if (result === "critical_failure") {
      c.confused = 2;
      c.hp = Math.max(0, c.hp - 2);
      event(
        room,
        "gm",
        `${c.name} 沒有完成行動，受挫損失 2 生命，並陷入迷茫：下一次行動檢定 -2。`,
      );
      return;
    }
    if (!success) {
      if (s.scene === "harbor" || s.scene === "marsh") {
        const key = `attempt:${s.scene}`,
          attempts = s.flags.filter((f) => f === key).length;
        s.flags.push(key);
        if (attempts >= 1) {
          event(
            room,
            "gm",
            "雖然沒有順利完成，但你花時間排除錯誤，終於找到必要線索（失敗推進）。",
          );
          this.addClue(room, s.scene);
          return;
        }
      }
      event(
        room,
        "gm",
        "這次嘗試沒有取得成果，消耗一次行動。你可以換個方法再試。",
      );
      return;
    }
    if (crit) {
      c.gold += 3;
      event(room, "gm", `${c.name} 額外發現一枚舊銀幣，價值 3 金幣。`);
    }
    if (intent === "attack" || intent === "skill") {
      const damage = (intent === "skill" ? 8 : 5) + (crit ? 4 : 0);
      s.enemyHp = Math.max(0, s.enemyHp - damage);
      event(room, "gm", `${c.name} 命中潮汐守衛，造成 ${damage} 傷害。`);
      if (s.enemyHp === 0) {
        s.flags.push("guard-cleared");
        s.combat = false;
        event(room, "gm", "守衛跪下，鏽刃化為潮水，通往燈室的道路已開啟。");
      }
    } else if (s.scene === "harbor" || s.scene === "marsh") {
      this.addClue(room, s.scene);
    } else if (intent === "talk" && !s.flags.includes("guard-cleared")) {
      if (s.flags.filter((f) => f.startsWith("clue:")).length >= 2) {
        s.flags.push("guard-cleared");
        s.combat = false;
        event(
          room,
          "gm",
          "你說出航路誓言，守衛認出你的來意，收起長刃。你以交涉通過了守衛。",
        );
      } else
        event(
          room,
          "gm",
          "守衛願意傾聽，但你還需要港口與濕地的兩份線索，才能說出完整誓言。",
        );
    } else if (intent === "interact") {
      if (!s.flags.includes("guard-cleared"))
        event(
          room,
          "gm",
          "守衛擋住燈室入口。你可以交談或戰鬥，也可以回頭尋找線索。",
        );
      else if (s.flags.filter((f) => f.startsWith("clue:")).length < 2)
        event(room, "gm", "你還不知道啟動方式，請返回港口與濕地尋找兩份線索。");
      else {
        room.phase = "won";
        s.combat = false;
        room.members.forEach((m) => {
          const ch = m.character!;
          ch.gold += 15;
          ch.xp += 20;
          const level = 1 + Math.floor(ch.xp / 20);
          const levels = level - ch.level;
          ch.level = level;
          ch.maxHp += levels * 2;
          ch.hp = Math.min(ch.maxHp, ch.hp + levels * 2);
        });
        event(
          room,
          "gm",
          s.quest === 0
            ? "燈塔再度亮起，霧海出現了一條回家的路。任務完成！每位旅人獲得 15 金幣、20 經驗與一個等級。下一段故事，將記住你們的選擇。"
            : "航路石發出悠長的和聲，守燈人的回聲終於安息。後續任務完成！每位旅人獲得 15 金幣、20 經驗與一個等級。",
        );
      }
    } else
      event(
        room,
        "gm",
        s.flags.includes("guard-cleared")
          ? "燈室就在前方，現在可以調查並啟動裝置。"
          : "守衛身上的符文呼應著潮汐圖。也許你可以用誓言通過，或選擇戰鬥。",
      );
  }
  endTurn(room: Room, userId: string, defending = false) {
    const s = sessionOf(room),
      c = memberOf(room, userId).character!;
    if (c.confused > 0) c.confused--;
    if (room.phase !== "playing") return;
    if (s.combat && s.enemyHp > 0 && c.hp > 0) {
      const damage = defending ? 1 : 3;
      c.hp = Math.max(0, c.hp - damage);
      event(room, "gm", `潮汐守衛反擊，${c.name} 受到 ${damage} 傷害。`);
    }
    if (room.members.every((m) => m.character!.hp <= 0)) {
      room.phase = "lost";
      s.pending = null;
      s.combat = false;
      event(
        room,
        "gm",
        "隊伍倒在潮水中。這次任務失敗，角色與旅程紀錄仍然保留。你可以回首頁建立新冒險。",
      );
      return;
    }
    for (let i = 0; i < s.turnOrder.length; i++) {
      s.turnIndex = (s.turnIndex + 1) % s.turnOrder.length;
      if (memberOf(room, active(room)!).character!.hp > 0) break;
    }
  }
  tick(now = Date.now()) {
    for (const saved of this.store.rooms()) {
      let changed = false;
      this.store.transaction(() => {
        const room = this.store.get(saved.id),
          s = room.session;
        if (s?.busy && now - s.busy.startedAt > 30000) {
          s.busy = null;
          event(
            room,
            "system",
            "AI 工作逾時，已解除等待。已確認的結果仍保留。",
          );
          changed = true;
        }
        if (s?.vote && now > s.vote.expiresAt) {
          s.vote = null;
          event(room, "system", "隊伍確認逾時，留在原場景。");
          changed = true;
        }
        const present = this.presence(room),
          actor = active(room),
          status = present.find((p) => p.userId === actor);
        if (
          s &&
          room.phase === "playing" &&
          !s.busy &&
          !s.vote &&
          present.some((p) => p.online) &&
          status &&
          !status.online &&
          status.offlineSince !== null &&
          now - status.offlineSince >= this.options.graceMs
        ) {
          s.pending = null;
          event(room, "system", "行動者斷線已超過寬限期，自動防禦／跳過。");
          this.endTurn(room, actor!, true);
          changed = true;
          // Require another grace period before skipping this player again.
          this.offlineSince.set(`${room.id}:${actor}`, now);
        }
        const host = present.find((p) => p.userId === room.hostId);
        if (
          host &&
          !host.online &&
          host.offlineSince !== null &&
          now - host.offlineSince >= this.options.graceMs
        ) {
          const next = room.members.find((m) =>
            present.some((p) => p.userId === m.userId && p.online),
          );
          if (next && next.userId !== room.hostId) {
            room.hostId = next.userId;
            event(room, "system", `${next.displayName} 接任房間管理。`);
            changed = true;
          }
        }
        if (changed) {
          room.revision++;
          this.store.save(room);
        }
      });
      if (changed) this.onChange(saved.id);
    }
  }
}
