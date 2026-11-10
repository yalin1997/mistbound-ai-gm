import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { io } from "socket.io-client";
import {
  intentNames,
  jobs,
  objectives,
  questNames,
  races,
  scenes,
  statNames,
} from "../shared/content";
import type {
  Character,
  Chat,
  Job,
  Race,
  RoomView,
  SceneId,
  Stat,
} from "../shared/types";

type User = { id: string; name: string };
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function api<T>(path: string, data?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...(data !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {}),
  });
  const body = await res.json();
  if (!res.ok) throw new HttpError(res.status, body.error ?? "請求未完成");
  return body as T;
}
const roomFromUrl = () =>
  /^#\/room\/([a-z0-9]{12})$/.exec(location.hash)?.[1] ?? null;
const phaseLabel: Record<string, string> = {
  lobby: "準備中",
  playing: "旅途中",
  won: "任務完成",
  lost: "旅程結束",
};
const jobIcons: Record<Job, string> = {
  guardian: "⚔",
  ranger: "➶",
  arcanist: "✧",
};
const noop = () => {};

function Brand() {
  return (
    <div className="brand">
      <span className="brand-symbol">✧</span>
      <div>
        霧海紀事<small>MISTBOUND CHRONICLES</small>
      </div>
    </div>
  );
}
function Pill({
  children,
  live = false,
}: {
  children: ReactNode;
  live?: boolean;
}) {
  return (
    <span className={`pill ${live ? "live" : ""}`}>
      <i />
      {children}
    </span>
  );
}

export function Atlas({
  scene,
  visited = ["harbor"],
  decorative = false,
}: {
  scene?: SceneId;
  visited?: SceneId[];
  decorative?: boolean;
}) {
  return (
    <svg
      className={`atlas ${decorative ? "decorative" : ""}`}
      viewBox="0 0 600 400"
      role="img"
      aria-label="霧海地圖：暮潮港、低語濕地、無光燈塔"
    >
      <defs>
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path
            d="M 30 0 L 0 0 0 30"
            fill="none"
            stroke="#94b3a5"
            strokeOpacity=".07"
          />
        </pattern>
        <radialGradient id="glow">
          <stop stopColor="#9cd5b1" stopOpacity=".25" />
          <stop offset="1" stopColor="#9cd5b1" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="land" x2="1" y2="1">
          <stop stopColor="#344d43" />
          <stop offset="1" stopColor="#182e2a" />
        </linearGradient>
      </defs>
      <rect width="600" height="400" fill="#142723" />
      <rect width="600" height="400" fill="url(#grid)" />
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          d={`M ${70 + i * 9} 400 Q ${180 + i * 12} 300 ${200 + i * 12} 260 T ${320 + i * 12} 170 T ${420 + i * 12} 10`}
          fill="none"
          stroke="#8aab9c"
          strokeOpacity={0.06 + i * 0.015}
          strokeWidth="1"
        />
      ))}
      <path
        d="M0 0H490L479 55 453 75 463 99 422 123 411 158 366 176 361 203 325 223 323 250 267 269 245 292 198 288 168 324 159 354 118 370 96 400H0Z"
        fill="url(#land)"
        stroke="#789183"
        strokeOpacity=".45"
      />
      <path
        d="M0 0H455L442 39 426 68 397 92 400 131 353 145 326 180 301 184 280 226 239 247 209 258 168 282 147 320 101 340 72 400"
        fill="none"
        stroke="#9bb3a2"
        strokeOpacity=".13"
      />
      <path
        d="M0 60Q170 -30 318 80T360 140M0 110Q140 30 285 122T300 180M0 160Q120 80 218 167T245 230M0 210Q100 180 135 217T185 270"
        fill="none"
        stroke="#b7c7a6"
        strokeOpacity=".09"
      />
      {[
        { x: 100, y: 140 },
        { x: 170, y: 115 },
        { x: 210, y: 100 },
        { x: 335, y: 65 },
      ].map((p, i) => (
        <g key={i} stroke="#788e73" strokeOpacity=".45" fill="none">
          <path
            d={`M${p.x - 15} ${p.y + 15}l15 -30 18 30m-27 -12 9 -18 10 18`}
          />
        </g>
      ))}
      <path
        d="M125 270Q165 216 285 190T465 90"
        fill="none"
        stroke="#b6a16d"
        strokeWidth="1.5"
        strokeDasharray="4 6"
        opacity=".75"
      />
      <text
        x="400"
        y="320"
        className="sea-label"
        transform="rotate(-24 400 320)"
      >
        T H E M I S T S E A
      </text>
      <g
        transform="translate(535 335)"
        stroke="#a99d7c"
        fill="none"
        opacity=".6"
      >
        <path d="M0 -28V28M-28 0H28M-15 -15L15 15M-15 15L15 -15" />
        <path d="M0 -22L6 0 0 22 -6 0Z" />
        <circle r="18" />
        <text x="-4" y="-34" fill="#a99d7c" stroke="none" fontSize="10">
          N
        </text>
      </g>
      {Object.entries(scenes).map(([id, p]) => (
        <g key={id} transform={`translate(${p.x} ${p.y})`}>
          {scene === id && <circle r="46" fill="url(#glow)" />}
          <circle
            r={scene === id ? 12 : 8}
            fill="#172a26"
            stroke={scene === id ? "#d4c28b" : "#829e89"}
            strokeWidth="1.5"
          />
          <circle
            r="3"
            fill={visited.includes(id as SceneId) ? "#d4c28b" : "#5f776c"}
          />
          <text
            y="30"
            textAnchor="middle"
            fill={scene === id ? "#e4d6b0" : "#a7b8a7"}
            fontSize="14"
            fontFamily="serif"
            letterSpacing="2"
          >
            {p.name}
          </text>
        </g>
      ))}
      <text x="28" y="34" fill="#c3bb9e" fontSize="11" letterSpacing="3">
        霧 海 沿 岸 · 卷 一
      </text>
    </svg>
  );
}

function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(true),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError("");
    try {
      onLogin(
        await api<User>(`/auth/${register ? "register" : "login"}`, {
          name,
          password,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <span className="eyebrow">一人，也能踏上一場冒險</span>
        <h1>
          故事的下一頁，
          <br />
          由你擲下。
        </h1>
        <p>
          在霧海邊界，與 AI GM 一起探索未知。
          <br />
          獨自啟程，或邀請遠方的朋友同行。
        </p>
        <Atlas decorative />
        <span className="auth-note">
          原創 D20 冒險 · 單人／2–4 人合作 · 自動存檔
        </span>
      </section>
      <section className="auth-card">
        <span className="eyebrow">THE JOURNEY BEGINS</span>
        <h2>{register ? "留下旅人的名字" : "歡迎回到霧海"}</h2>
        <p className="muted">建立帳號即可保存角色與每一段旅程。</p>
        <div className="segmented">
          <button
            className={register ? "selected" : ""}
            onClick={() => {
              setRegister(true);
              setError("");
            }}
          >
            建立帳號
          </button>
          <button
            className={!register ? "selected" : ""}
            onClick={() => {
              setRegister(false);
              setError("");
            }}
          >
            登入
          </button>
        </div>
        <form onSubmit={submit}>
          <label>
            旅人名稱
            <input
              required
              minLength={2}
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="username"
              placeholder="例如：海風旅人"
            />
          </label>
          <label>
            密碼
            <input
              required
              minLength={8}
              maxLength={128}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={register ? "new-password" : "current-password"}
              placeholder="至少 8 個字元"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary wide" disabled={pending}>
            {pending
              ? "正在準備…"
              : register
                ? "建立帳號，開始冒險 →"
                : "登入，接續旅程 →"}
          </button>
        </form>
        <small className="muted">
          測試版帳號僅用於保存遊戲，尚未提供密碼重設，請記住名稱與密碼。
        </small>
      </section>
    </div>
  );
}

interface Save {
  id: string;
  mode: string;
  phase: string;
  count: number;
  quest: number;
  createdAt: string;
}
function Home({
  open,
  report,
  aiMode,
}: {
  open: (id: string) => void;
  report: (e: unknown) => void;
  aiMode: string;
}) {
  const [saves, setSaves] = useState<Save[]>([]),
    [joinId, setJoinId] = useState(""),
    [pending, setPending] = useState(false);
  useEffect(() => {
    api<Save[]>("/rooms").then(setSaves).catch(report);
  }, [report]);
  async function create(mode: "solo" | "coop") {
    setPending(true);
    try {
      const r = await api<RoomView>("/rooms", { mode });
      open(r.id);
    } catch (e) {
      report(e);
    } finally {
      setPending(false);
    }
  }
  async function join(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const id = /room\/([a-z0-9]{12})/.exec(joinId)?.[1] ?? joinId.trim();
      const r = await api<RoomView>(`/rooms/${id}/join`, {});
      open(r.id);
    } catch (e) {
      report(e);
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="home">
      <div className="home-heading">
        <div>
          <span className="eyebrow">你的冒險桌，隨時開場</span>
          <h1>霧散之前，啟程。</h1>
          <p className="muted">一個世界，一顆 D20，以及無人能預料的下一步。</p>
        </div>
        <Pill live={aiMode === "live"}>
          {aiMode === "live" ? "AI GM 已配置" : "規則試玩模式"}
        </Pill>
      </div>
      <section className="feature-card">
        <div className="feature-copy">
          <span className="eyebrow">序章冒險 / THE FIRST LIGHT</span>
          <h2>重燃霧海之燈</h2>
          <p>
            三天前，海崖上的燈塔熄滅了。
            <br />
            船隻迷失在霧中，而守燈人再也沒有回來。
          </p>
          <div className="feature-facts">
            <span>◷ 30–60 分鐘目標</span>
            <span>◇ 探索 · 交涉 · 戰鬥</span>
          </div>
          <div className="button-row">
            <button
              className="primary"
              disabled={pending}
              onClick={() => create("solo")}
            >
              單人啟程 <span>↗</span>
            </button>
            <button
              className="secondary"
              disabled={pending}
              onClick={() => create("coop")}
            >
              建立合作房間 ＋
            </button>
          </div>
        </div>
        <Atlas decorative />
      </section>
      <section className="home-lower">
        <div>
          <div className="section-heading">
            <h2>你的旅程</h2>
            <span className="muted">自動保存 · 隨時接續</span>
          </div>
          {saves.length === 0 ? (
            <div className="empty-state">
              <span>⌁</span>
              <p>冒險紀錄還是一張空白的航海圖。</p>
              <small>從上方開始第一段旅程吧。</small>
            </div>
          ) : (
            <div className="saves">
              {saves
                .slice()
                .reverse()
                .map((s) => (
                  <button
                    className="save-row"
                    key={s.id}
                    onClick={() => open(s.id)}
                  >
                    <span className="save-icon">
                      {s.mode === "solo" ? "♙" : "♟"}
                    </span>
                    <span>
                      <strong>{questNames[s.quest]}</strong>
                      <small>
                        {s.mode === "solo" ? "單人" : `${s.count} 人合作`} ·{" "}
                        {phaseLabel[s.phase]} ·{" "}
                        {new Date(s.createdAt).toLocaleDateString("zh-TW")}
                      </small>
                    </span>
                    <span className="save-arrow">→</span>
                  </button>
                ))}
            </div>
          )}
        </div>
        <aside className="join-card">
          <span className="eyebrow">BETTER TOGETHER</span>
          <h2>有朋友在等你？</h2>
          <p className="muted">
            貼上邀請連結或房間編號，
            <br />
            加入同一段冒險。
          </p>
          <form onSubmit={join}>
            <label>
              邀請連結／房間編號
              <input
                required
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                placeholder="貼上邀請連結或 12 碼房號"
              />
            </label>
            <button className="secondary wide" disabled={pending}>
              加入房間 →
            </button>
          </form>
        </aside>
      </section>
    </main>
  );
}

function CharacterBuilder({
  save,
  existing,
  disabled,
}: {
  save: (data: unknown) => void;
  existing: Character | null;
  disabled: boolean;
}) {
  const [name, setName] = useState(existing?.name ?? ""),
    [race, setRace] = useState<Race>(existing?.race ?? "human"),
    [job, setJob] = useState<Job>(existing?.job ?? "guardian"),
    [stats, setStats] = useState(
      existing?.stats ?? { strength: 2, agility: 2, insight: 2 },
    );
  const left = 6 - Object.values(stats).reduce((a, b) => a + b, 0);
  return (
    <form
      className="builder panel"
      onSubmit={(e) => {
        e.preventDefault();
        save({ name, race, job, stats });
      }}
    >
      <div className="section-heading">
        <h2>{existing ? "調整你的角色" : "建立你的角色"}</h2>
        <span className="muted">POINT BUY / 6</span>
      </div>
      <label>
        角色名字
        <input
          required
          maxLength={24}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="故事將記住這個名字"
        />
      </label>
      <label>選擇種族</label>
      <div className="choice-grid">
        {Object.entries(races).map(([key, r]) => (
          <button
            type="button"
            className={`choice ${race === key ? "selected" : ""}`}
            key={key}
            onClick={() => setRace(key as Race)}
          >
            <strong>{r.name}</strong>
            <small>{statNames[r.bonus]} +1</small>
          </button>
        ))}
      </div>
      <p className="help">{races[race].lore}</p>
      <label>選擇職業</label>
      <div className="choice-grid">
        {Object.entries(jobs).map(([key, j]) => (
          <button
            type="button"
            className={`choice ${job === key ? "selected" : ""}`}
            key={key}
            onClick={() => setJob(key as Job)}
          >
            <span>{jobIcons[key as Job]}</span>
            <strong>{j.name}</strong>
          </button>
        ))}
      </div>
      <p className="help">{jobs[job].skill}</p>
      <div className="section-heading">
        <label>能力配點</label>
        <span className={left !== 0 ? "gold" : "muted"}>剩餘 {left} 點</span>
      </div>
      <div className="stat-buy">
        {(Object.keys(statNames) as Stat[]).map((s) => (
          <div key={s}>
            <span>{statNames[s]}</span>
            <div>
              <button
                type="button"
                aria-label={`減少${statNames[s]}`}
                disabled={stats[s] === 0}
                onClick={() => setStats({ ...stats, [s]: stats[s] - 1 })}
              >
                −
              </button>
              <strong>{stats[s]}</strong>
              <button
                type="button"
                aria-label={`增加${statNames[s]}`}
                disabled={stats[s] === 4 || left <= 0}
                onClick={() => setStats({ ...stats, [s]: stats[s] + 1 })}
              >
                ＋
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="equipment-preview">
        <span>起始裝備</span>
        <p>{jobs[job].equipment.join(" · ")} · 回復藥水 ×2</p>
      </div>
      <button className="primary wide" disabled={disabled || left !== 0}>
        {existing ? "保存角色設定" : "完成角色建立 →"}
      </button>
    </form>
  );
}

function CharacterCard({ c, own = false }: { c: Character; own?: boolean }) {
  return (
    <div className="character-card">
      <div className="character-title">
        <div className={`portrait ${c.job}`}>{jobIcons[c.job]}</div>
        <div>
          <h3>{c.name}</h3>
          <small>
            {races[c.race].name} · {jobs[c.job].name} · Lv.{c.level}
            {own ? " · 你" : ""}
          </small>
        </div>
      </div>
      <div className="hp-label">
        <span>生命</span>
        <span>
          {c.hp} / {c.maxHp}
        </span>
      </div>
      <div className="hp-track">
        <i style={{ width: `${(c.hp / c.maxHp) * 100}%` }} />
      </div>
      {c.confused > 0 && <p className="condition">迷茫：下一次檢定 -2</p>}
    </div>
  );
}

function RoomScreen({
  initial,
  me,
  back,
  report,
}: {
  initial: RoomView;
  me: User;
  back: () => void;
  report: (e: unknown) => void;
}) {
  const [room, setRoom] = useState(initial),
    [connected, setConnected] = useState(false),
    [sending, setSending] = useState(false),
    [text, setText] = useState(""),
    [tab, setTab] = useState("story"),
    [chat, setChat] = useState(""),
    [copied, setCopied] = useState(false);
  const [uncertain, setUncertain] = useState<{
    type: string;
    data: unknown;
    key: string;
    revision: number;
  } | null>(null);
  const end = useRef<HTMLDivElement>(null),
    current = useRef(room);
  current.current = room;
  const own = room.members.find((m) => m.userId === me.id)!,
    s = room.session,
    host = room.hostId === me.id,
    c = own.character;
  const actor = room.members.find((m) => m.userId === room.activeActorId),
    yourTurn = room.activeActorId === me.id;
  const blocked = sending || !!uncertain || !connected || !!s?.busy;
  const canAct =
    !blocked && yourTurn && room.phase === "playing" && !s?.vote && !s?.pending;
  useEffect(() => {
    const socket = io({ autoConnect: false });
    socket.on("connect", () =>
      socket.emit("watch", initial.id, (ack: { error?: string }) => {
        if (ack.error) report(new Error(ack.error));
        else setConnected(true);
      }),
    );
    socket.on("state", (state: RoomView) =>
      setRoom((old) => (state.revision >= old.revision ? state : old)),
    );
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [initial.id, report]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [room.events.length]);
  async function send(
    type: string,
    data: unknown = {},
    retry?: typeof uncertain,
  ) {
    if (sending) return;
    const command = retry ?? {
      type,
      data,
      key: crypto.randomUUID(),
      revision: current.current.revision,
    };
    setSending(true);
    try {
      const updated = await api<RoomView>(
        `/rooms/${room.id}/commands`,
        command,
      );
      setRoom((old) => (updated.revision >= old.revision ? updated : old));
      setUncertain(null);
      if (type === "action") setText("");
    } catch (e) {
      if (!(e instanceof HttpError)) setUncertain(command);
      else {
        setUncertain(null);
        api<RoomView>(`/rooms/${room.id}`)
          .then((updated) =>
            setRoom((old) =>
              updated.revision >= old.revision ? updated : old,
            ),
          )
          .catch(noop);
      }
      report(e);
    } finally {
      setSending(false);
    }
  }
  const action = (intent: string, target?: string) =>
    send("action", { intent, ...(target ? { target } : {}) });
  async function invite() {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/#/room/${room.id}`,
      );
      setCopied(true);
    } catch {
      report(new Error("無法自動複製，請選取下方房號或複製網址列。"));
    }
  }
  async function sendChat(e: FormEvent) {
    e.preventDefault();
    if (!chat.trim()) return;
    try {
      await api(`/rooms/${room.id}/chat`, { text: chat });
      setChat("");
    } catch (e) {
      report(e);
    }
  }
  return (
    <main className="room-shell">
      <div className="room-toolbar">
        <button className="back" onClick={back}>
          ← 冒險首頁
        </button>
        <div className="room-meta">
          <Pill live={connected}>
            {connected ? "已連線 · 自動存檔" : "連線中斷 · 正在重連"}
          </Pill>
          <span className="muted">
            {room.mode === "solo"
              ? "單人冒險"
              : `${room.members.length}/4 人合作`}
          </span>
          <button className="text-button" onClick={invite}>
            {copied ? "已複製 ✓" : "複製邀請 ↗"}
          </button>
        </div>
      </div>
      {uncertain && (
        <div className="uncertain" role="alert">
          操作回覆尚未確認，請用同一編號重試以避免重複結算。
          <button
            disabled={sending}
            onClick={() => send(uncertain.type, uncertain.data, uncertain)}
          >
            重試原操作
          </button>
        </div>
      )}
      {room.phase === "lobby" ? (
        <>
          <div className="lobby-heading">
            <span className="eyebrow">PREPARE YOUR ADVENTURE</span>
            <h1>在出發之前</h1>
            <p className="muted">
              {room.mode === "coop"
                ? "邀請 1–3 位朋友，建立角色並準備。AI GM 會帶領你們啟程。"
                : "選擇你的身份。即使只有一人，故事也會為你展開。"}
            </p>
            <code>房號 {room.id}</code>
          </div>
          <div className="lobby-grid">
            <CharacterBuilder
              existing={c}
              disabled={blocked}
              save={(data) => send("character", data)}
            />
            <aside>
              <section className="panel party-lobby">
                <div className="section-heading">
                  <h2>同行旅人</h2>
                  <span className="muted">
                    {room.members.length} / {room.mode === "solo" ? 1 : 4}
                  </span>
                </div>
                {room.members.map((m) => (
                  <div className="party-person" key={m.userId}>
                    <div className="avatar">
                      {m.character ? jobIcons[m.character.job] : "♙"}
                    </div>
                    <div>
                      <strong>{m.character?.name ?? m.displayName}</strong>
                      <small>
                        {m.character
                          ? `${races[m.character.race].name} · ${jobs[m.character.job].name}`
                          : "正在建立角色"}
                        {room.hostId === m.userId ? " · 房主" : ""}
                      </small>
                    </div>
                    <span className={m.ready ? "ready" : "muted"}>
                      {m.ready ? "準備完成" : "準備中"}
                    </span>
                  </div>
                ))}
                {room.mode === "coop" && room.members.length < 4 && (
                  <button className="invite-slot" onClick={invite}>
                    ＋ 邀請朋友加入
                  </button>
                )}
                <button
                  className={own.ready ? "secondary wide" : "primary wide"}
                  disabled={blocked || !c}
                  onClick={() => send("ready")}
                >
                  {own.ready ? "取消準備" : "我準備好了 ✓"}
                </button>
                {host ? (
                  <button
                    className="primary wide"
                    disabled={
                      blocked ||
                      room.members.some((m) => !m.ready) ||
                      (room.mode === "coop" && room.members.length < 2)
                    }
                    onClick={() => send("start")}
                  >
                    開始冒險 →
                  </button>
                ) : (
                  <p className="help">準備完成後，由房主開始冒險。</p>
                )}
                {!host &&
                  !room.presence.find((p) => p.userId === room.hostId)
                    ?.online && (
                    <button
                      className="text-button"
                      onClick={() => send("claim-host")}
                      disabled={blocked}
                    >
                      接任房間管理
                    </button>
                  )}
              </section>
              <section className="lobby-quest panel">
                <span className="eyebrow">YOUR FIRST CHAPTER</span>
                <h2>重燃霧海之燈</h2>
                <Atlas />
                <p className="muted">
                  尋找潮汐圖、穿過低語濕地，決定如何面對燈塔守衛。戰鬥從來不是唯一的答案。
                </p>
                <div className="rule-note">
                  D20 ＋ 能力加值 ≥ 難度即成功。
                  <br />
                  自然 1 大失敗，自然 20 大成功。
                </div>
              </section>
            </aside>
          </div>
        </>
      ) : (
        <>
          <div className="game-heading">
            <div>
              <span className="eyebrow">
                CHAPTER {s!.quest + 1 < 10 ? "0" : ""}
                {s!.quest + 1} / MIST COAST
              </span>
              <h1>{questNames[s!.quest]}</h1>
            </div>
            <div className="turn-tag">
              {room.phase === "playing" ? (
                <>
                  <span className="pulse" />
                  {s?.busy
                    ? "GM 正在思考…"
                    : yourTurn
                      ? "輪到你的行動"
                      : `等待 ${actor?.character?.name ?? "隊友"}`}
                </>
              ) : (
                phaseLabel[room.phase]
              )}
            </div>
          </div>
          <nav className="mobile-tabs">
            {[
              ["map", "場景地圖"],
              ["story", "故事與行動"],
              ["character", "角色背包"],
            ].map(([id, label]) => (
              <button
                className={tab === id ? "active" : ""}
                key={id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="game-grid">
            <section
              className={`map-column mobile-${tab === "map" ? "show" : "hide"}`}
            >
              <div className="panel map-panel">
                <div className="section-heading">
                  <span className="eyebrow">THE MIST COAST</span>
                  <span className="muted">固定地圖 · v1</span>
                </div>
                <Atlas scene={s!.scene} visited={s!.visited} />
                <div className="scene-copy">
                  <span className="eyebrow">{scenes[s!.scene].subtitle}</span>
                  <h2>{scenes[s!.scene].name}</h2>
                  <p>{scenes[s!.scene].description}</p>
                </div>
                <div className="travel">
                  <label>前往相鄰區域</label>
                  {(Object.keys(scenes) as SceneId[])
                    .filter(
                      (id) =>
                        Math.abs(
                          ["harbor", "marsh", "tower"].indexOf(id) -
                            ["harbor", "marsh", "tower"].indexOf(s!.scene),
                        ) === 1,
                    )
                    .map((id) => (
                      <button
                        key={id}
                        className="travel-button"
                        disabled={!canAct || s!.combat}
                        onClick={() => action("move", id)}
                      >
                        {scenes[id].name}
                        <span>→</span>
                      </button>
                    ))}
                </div>
              </div>
              <div className="objective panel">
                <span className="eyebrow">當前任務</span>
                <p>{objectives[s!.quest]}</p>
                <div className="checklist">
                  <span className={s!.clues >= 2 ? "done" : ""}>
                    {s!.clues >= 2 ? "✓" : "○"} 尋找線索 {s!.clues}/2
                  </span>
                  <span className={s!.objectiveReady ? "done" : ""}>
                    {s!.objectiveReady ? "✓" : "○"} 通過守衛
                  </span>
                  <span className={room.phase === "won" ? "done" : ""}>
                    {room.phase === "won" ? "✓" : "○"} 啟動裝置
                  </span>
                </div>
              </div>
            </section>
            <section
              className={`story-column panel mobile-${tab === "story" ? "show" : "hide"}`}
            >
              <div className="story-top">
                <div>
                  <span className="gm-avatar">✧</span>
                  <strong>霧海 GM</strong>
                </div>
                <Pill live={room.aiMode === "live"}>
                  {room.aiMode === "live" ? "AI 敘事" : "規則模式"}
                </Pill>
              </div>
              <div className="event-list" aria-live="polite">
                {room.events.map((e) => (
                  <article className={`event ${e.kind}`} key={e.seq}>
                    <span className="event-index">
                      {String(e.seq).padStart(2, "0")}
                    </span>
                    <div>
                      {e.kind === "roll" && (
                        <span className="eyebrow">D20 · 檢定結果</span>
                      )}
                      <p>{e.text}</p>
                    </div>
                  </article>
                ))}
                {s!.busy && (
                  <div className="thinking">
                    <span>✧</span> GM 正在編織下一段故事
                    <span className="dots">…</span>
                  </div>
                )}
                <div ref={end} />
              </div>
              {s!.vote && (
                <div className="vote-panel">
                  <strong>隊伍決策：前往{scenes[s!.vote.target].name}</strong>
                  <p>
                    已確認 {s!.vote.approvals.length}/{s!.vote.required.length}{" "}
                    位旅人 · 60 秒內未完成將取消
                  </p>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={blocked || s!.vote.approvals.includes(me.id)}
                      onClick={() => send("vote", { approve: true })}
                    >
                      同意移動
                    </button>
                    <button
                      className="secondary"
                      disabled={blocked}
                      onClick={() => send("vote", { approve: false })}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
              {s!.pending && (
                <div className="dice-panel">
                  <div className="d20">20</div>
                  <div>
                    <strong>{s!.pending.label}</strong>
                    <p>
                      {statNames[s!.pending.stat]}{" "}
                      {s!.pending.modifier >= 0 ? "+" : ""}
                      {s!.pending.modifier} <span>／ DC {s!.pending.dc}</span>
                    </p>
                    <small>自然 1 大失敗 · 自然 20 大成功</small>
                  </div>
                  <button
                    className="primary"
                    disabled={blocked || !yourTurn}
                    onClick={() => send("roll", { checkId: s!.pending!.id })}
                  >
                    {yourTurn ? "擲出 D20" : "等待擲骰"}
                  </button>
                </div>
              )}
              {room.phase === "playing" ? (
                <div className="action-composer">
                  <div className="section-heading">
                    <label>
                      {yourTurn
                        ? "你打算怎麼做？"
                        : `現在是 ${actor?.character?.name ?? "隊友"} 的回合`}
                    </label>
                    <small className="muted">每回合一次行動</small>
                  </div>
                  <div className="quick-actions">
                    {(
                      [
                        "observe",
                        "talk",
                        "interact",
                        ...(s!.scene === "tower" && !s!.objectiveReady
                          ? ["attack", "skill"]
                          : []),
                        "defend",
                        "heal",
                        "pass",
                      ] as const
                    ).map((intent) => (
                      <button
                        key={intent}
                        disabled={
                          !canAct ||
                          (intent === "heal" &&
                            (!c?.potions || c.hp === c.maxHp))
                        }
                        onClick={() => action(intent)}
                      >
                        {intentNames[intent as keyof typeof intentNames]}
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (text.trim()) send("action", { text });
                    }}
                  >
                    <label className="sr-only" htmlFor="free-action">
                      自由行動
                    </label>
                    <div className="free-input">
                      <textarea
                        id="free-action"
                        rows={2}
                        maxLength={500}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        disabled={!canAct}
                        placeholder={
                          room.aiMode === "live"
                            ? "或描述你的行動，例如：試著用守衛的誓言說服它…"
                            : "規則試玩：可輸入「觀察四周」等關鍵字；自由語意需設定 AI"
                        }
                      />
                      <button
                        title="送出自由行動"
                        aria-label="送出自由行動"
                        disabled={!canAct || !text.trim()}
                        type="submit"
                      >
                        ↑
                      </button>
                    </div>
                  </form>
                  <small className="help">
                    {room.aiMode === "live"
                      ? "AI 理解你的意圖，規則決定結果。"
                      : "目前沒有使用 AI，快捷選項可完成整段冒險。"}
                  </small>
                </div>
              ) : (
                <div className="ending">
                  <span className="eyebrow">
                    {room.phase === "won"
                      ? "CHAPTER COMPLETE"
                      : "THE JOURNEY REMAINS"}
                  </span>
                  <h2>
                    {room.phase === "won"
                      ? "這段旅程，已被記住。"
                      : "故事還沒有結束。"}
                  </h2>
                  <p>角色與所有經歷已自動保存。</p>
                  {room.phase === "won" &&
                    s!.quest === 0 &&
                    (host ? (
                      <button
                        className="primary"
                        disabled={blocked}
                        onClick={() => send("next")}
                      >
                        接續第二章：守燈人的回聲 →
                      </button>
                    ) : (
                      <p>等待房主接續下一章。</p>
                    ))}
                  {(room.phase === "lost" || s!.quest === 1) && (
                    <button className="secondary" onClick={back}>
                      返回冒險首頁
                    </button>
                  )}
                </div>
              )}
            </section>
            <aside
              className={`character-column mobile-${tab === "character" ? "show" : "hide"}`}
            >
              <section className="panel own-character">
                <div className="section-heading">
                  <span className="eyebrow">你的角色</span>
                  <span className="muted">已保存 ✓</span>
                </div>
                {c && (
                  <>
                    <CharacterCard c={c} own />
                    <div className="mini-stats">
                      {(Object.keys(statNames) as Stat[]).map((stat) => (
                        <div key={stat}>
                          <strong>
                            {c.stats[stat] +
                              (races[c.race].bonus === stat ? 1 : 0)}
                          </strong>
                          <small>{statNames[stat]}</small>
                        </div>
                      ))}
                    </div>
                    <div className="resources">
                      <span>
                        ✧ 專注 <b>{c.focus}/3</b>
                      </span>
                      <span>
                        ◈ 金幣 <b>{c.gold}</b>
                      </span>
                      <span>
                        ◇ 經驗 <b>{c.xp}</b>
                      </span>
                      <span>
                        ⚗ 藥水 <b>{c.potions}</b>
                      </span>
                    </div>
                    <div className="inventory">
                      <label>裝備與技能</label>
                      {c.equipment.map((item) => (
                        <div key={item}>
                          <span>◇</span>
                          {item}
                        </div>
                      ))}
                      <p className="help">{jobs[c.job].skill}</p>
                    </div>
                  </>
                )}
              </section>
              {s!.scene === "tower" && !s!.objectiveReady && (
                <section className="enemy panel">
                  <span className="eyebrow">潮汐守衛</span>
                  <h3>鏽刃下的誓言</h3>
                  <div className="hp-label">
                    <span>生命</span>
                    <span>
                      {s!.enemyHp} / {s!.enemyMaxHp}
                    </span>
                  </div>
                  <div className="hp-track">
                    <i
                      style={{
                        width: `${(s!.enemyHp / s!.enemyMaxHp) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="help">可以戰鬥，也可以帶著兩份線索交涉。</p>
                </section>
              )}
              {room.members.length > 1 && (
                <section className="panel teammates">
                  <span className="eyebrow">隊伍</span>
                  {room.members
                    .filter((m) => m.userId !== me.id)
                    .map((m) => (
                      <div key={m.userId}>
                        <CharacterCard c={m.character!} />
                        <span className="presence-label">
                          {room.presence.find((p) => p.userId === m.userId)
                            ?.online
                            ? "● 在線"
                            : "○ 離線"}
                        </span>
                      </div>
                    ))}
                </section>
              )}
              <section className="panel chat-panel">
                <span className="eyebrow">
                  {room.mode === "solo" ? "旅人筆記" : "隊伍聊天"}
                </span>
                <div className="chat-log">
                  {room.chat.length === 0 ? (
                    <p className="help">
                      {room.mode === "solo"
                        ? "記下想法，不會消耗行動。"
                        : "討論下一步，不會消耗行動。"}
                    </p>
                  ) : (
                    room.chat.map((m: Chat) => (
                      <p key={m.id}>
                        <strong>{m.name}</strong> {m.text}
                      </p>
                    ))
                  )}
                </div>
                <form onSubmit={sendChat}>
                  <label className="sr-only" htmlFor="chat">
                    聊天訊息
                  </label>
                  <input
                    id="chat"
                    value={chat}
                    onChange={(e) => setChat(e.target.value)}
                    maxLength={500}
                    placeholder="寫下訊息…"
                  />
                  <button
                    aria-label="送出訊息"
                    disabled={!connected || !chat.trim()}
                  >
                    ↗
                  </button>
                </form>
              </section>
              <p className="save-note">
                ◷ 每次行動後自動保存
                <br />
                房間 {room.id} · 版本 {room.revision}
              </p>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

export function App() {
  const [me, setMe] = useState<User | null>(null),
    [loaded, setLoaded] = useState(false),
    [roomId, setRoomId] = useState(roomFromUrl),
    [room, setRoom] = useState<RoomView | null>(null),
    [error, setError] = useState(""),
    [aiMode, setAiMode] = useState("rules");
  const report = useRef((e: unknown) =>
    setError(e instanceof Error ? e.message : "操作未完成"),
  ).current;
  useEffect(() => {
    api<User>("/me")
      .then(setMe)
      .catch((e) => {
        if (!(e instanceof HttpError) || e.status !== 401) report(e);
      })
      .finally(() => setLoaded(true));
    api<{ aiMode: string }>("/health")
      .then((h) => setAiMode(h.aiMode))
      .catch(report);
  }, [report]);
  useEffect(() => {
    const listener = () => {
      setRoom(null);
      setRoomId(roomFromUrl());
      setError("");
    };
    addEventListener("hashchange", listener);
    return () => removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    if (!me || !roomId) return;
    let cancelled = false;
    api<RoomView>(`/rooms/${roomId}`)
      .catch((e) => {
        if (e instanceof HttpError && e.status === 403)
          return api<RoomView>(`/rooms/${roomId}/join`, {});
        throw e;
      })
      .then((r) => {
        if (!cancelled) setRoom(r);
      })
      .catch((e) => {
        if (!cancelled) report(e);
      });
    return () => {
      cancelled = true;
    };
  }, [me, roomId, report]);
  function open(id: string) {
    location.hash = `/room/${id}`;
  }
  function back() {
    setRoom(null);
    setRoomId(null);
    location.hash = "";
    setError("");
  }
  async function logout() {
    try {
      await api("/logout", {});
      setMe(null);
      setRoom(null);
    } catch (e) {
      report(e);
    }
  }
  return (
    <>
      <header className="app-header">
        <button
          className="brand-button"
          onClick={back}
          aria-label="回到冒險首頁"
        >
          <Brand />
        </button>
        <div className="header-right">
          <span className="version-label">遊戲測試版 / 0.1</span>
          {me && (
            <>
              <span className="user-name">♙ {me.name}</span>
              <button className="text-button" onClick={logout}>
                登出
              </button>
            </>
          )}
        </div>
      </header>
      {error && (
        <div className="global-error" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="關閉錯誤訊息">
            ×
          </button>
        </div>
      )}
      {!loaded ? (
        <div className="loading">正在展開航海圖…</div>
      ) : !me ? (
        <Auth onLogin={setMe} />
      ) : roomId ? (
        room ? (
          <RoomScreen
            key={room.id}
            initial={room}
            me={me}
            back={back}
            report={report}
          />
        ) : (
          <div className="loading">
            <p>
              {error
                ? "無法進入這個房間，請檢查邀請連結或稍後重試。"
                : "正在尋找同行旅人…"}
            </p>
            <button className="secondary" onClick={back}>
              返回首頁
            </button>
          </div>
        )
      ) : (
        <Home open={open} report={report} aiMode={aiMode} />
      )}
      <footer className="app-footer">
        <span>✧ 霧海紀事</span>
        <span>你的選擇，會留下回聲。</span>
        <span>
          原創 D20 規則 ·{" "}
          {aiMode === "live"
            ? "AI 模式（需實測確認）"
            : "無 AI 金鑰 · 規則試玩"}
        </span>
      </footer>
    </>
  );
}
