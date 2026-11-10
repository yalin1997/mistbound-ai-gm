import express, { type Request } from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { randomInt } from "node:crypto";
import { Store, GameError } from "./store.js";
import { Engine } from "./engine.js";
import { RulesGm, type Gm } from "./gm.js";

const authInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(24)
      .regex(/^[\p{L}\p{N}_ -]+$/u),
    password: z.string().min(8).max(128),
  })
  .strict();
const characterInput = z
  .object({
    name: z.string().trim().min(1).max(24),
    race: z.enum(["human", "elf", "dwarf"]),
    job: z.enum(["guardian", "ranger", "arcanist"]),
    stats: z
      .object({
        strength: z.number().int().min(0).max(4),
        agility: z.number().int().min(0).max(4),
        insight: z.number().int().min(0).max(4),
      })
      .strict(),
  })
  .strict();
const commandInput = z
  .object({
    key: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    type: z.enum([
      "character",
      "ready",
      "start",
      "action",
      "roll",
      "vote",
      "next",
      "claim-host",
    ]),
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const actionInput = z.union([
  z.object({ text: z.string().trim().min(1).max(500) }).strict(),
  z
    .object({
      intent: z.enum([
        "observe",
        "talk",
        "interact",
        "attack",
        "skill",
        "defend",
        "heal",
        "move",
        "pass",
      ]),
      target: z.enum(["harbor", "marsh", "tower"]).optional(),
    })
    .strict(),
]);
function cookie(raw?: string) {
  return raw
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("mist_session="))
    ?.slice("mist_session=".length);
}

export function createGameServer(config: {
  dbPath: string;
  gm?: Gm;
  origin?: string;
  secure?: boolean;
  graceMs?: number;
  aiCalls?: number;
  aiTokens?: number;
  roll?: () => number;
  dist?: string;
}) {
  const store = new Store(config.dbPath);
  const engine = new Engine(store, config.gm ?? new RulesGm(), {
    graceMs: config.graceMs ?? 60000,
    callLimit: config.aiCalls ?? 100,
    tokenBudget: config.aiTokens ?? 300000,
    roll: config.roll ?? (() => randomInt(1, 21)),
  });
  const app = express(),
    http = createServer(app);
  app.disable("x-powered-by");
  function originAllowed(origin: string | undefined, host: string | undefined) {
    if (!origin) return true; // Non-browser clients still need credentials.
    if (config.origin) return origin === config.origin;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const io = new Server(http, {
    maxHttpBufferSize: 16384,
    allowRequest: (req, done) =>
      done(null, originAllowed(req.headers.origin, req.headers.host)),
  });
  const rates = new Map<string, { count: number; until: number }>();
  function limit(key: string, max: number) {
    const now = Date.now();
    if (rates.size > 10000)
      for (const [key, value] of rates)
        if (value.until < now) rates.delete(key);
    const rate = rates.get(key);
    if (!rate || rate.until < now)
      rates.set(key, { count: 1, until: now + 60000 });
    else {
      if (++rate.count > max)
        throw new GameError(429, "操作太頻繁，請稍候再試");
    }
  }
  function user(req: Request) {
    const found = store.user(cookie(req.headers.cookie));
    if (!found) throw new GameError(401, "請先登入你的旅人帳號");
    return found;
  }
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.path.startsWith("/api")) {
      res.setHeader("Cache-Control", "no-store");
      if (
        req.method !== "GET" &&
        (!originAllowed(req.headers.origin, req.headers.host) ||
          !req.is("application/json"))
      ) {
        res.status(403).json({ error: "僅接受同來源 JSON 請求" });
        return;
      }
      try {
        limit(`ip:${req.ip}`, 240);
      } catch (error) {
        next(error);
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: config.secure ?? false,
    path: "/",
    maxAge: 30 * 86400000,
  };
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, aiMode: engine.gm.mode, version: "0.1.0" }),
  );
  app.post("/api/auth/:method", (req, res) => {
    limit(`auth:${req.ip}`, 15);
    const input = authInput.parse(req.body);
    if (req.params.method !== "register" && req.params.method !== "login")
      throw new GameError(404, "找不到操作");
    const account =
      req.params.method === "register"
        ? store.register(input.name, input.password)
        : store.login(input.name, input.password);
    res.cookie("mist_session", store.issueSession(account.id), cookieOptions);
    res.json(account);
  });
  app.get("/api/me", (req, res) => res.json(user(req)));
  app.post("/api/logout", (req, res) => {
    const account = user(req);
    store.logout(cookie(req.headers.cookie)!);
    for (const socket of io.sockets.sockets.values())
      if (socket.data.user.id === account.id) socket.disconnect(true);
    res.clearCookie("mist_session", cookieOptions);
    res.json({ ok: true });
  });
  app.get("/api/rooms", (req, res) => {
    const account = user(req);
    res.json(
      store
        .rooms()
        .filter((r) => r.members.some((m) => m.userId === account.id))
        .map((r) => ({
          id: r.id,
          mode: r.mode,
          phase: r.phase,
          count: r.members.length,
          createdAt: r.createdAt,
          quest: r.session?.quest ?? 0,
        })),
    );
  });
  app.post("/api/rooms", (req, res) => {
    const account = user(req);
    limit(`create:${account.id}`, 10);
    const { mode } = z
      .object({ mode: z.enum(["solo", "coop"]) })
      .strict()
      .parse(req.body);
    const room = engine.create(account, mode);
    res.status(201).json(engine.view(room.id, account.id));
  });
  app.post("/api/rooms/:id/join", (req, res) => {
    const account = user(req);
    limit(`join:${account.id}`, 30);
    engine.join(String(req.params.id), account);
    res.json(engine.view(String(req.params.id), account.id));
  });
  app.get("/api/rooms/:id", (req, res) =>
    res.json(engine.view(String(req.params.id), user(req).id)),
  );
  app.get("/api/rooms/:id/events", (req, res) => {
    const view = engine.view(String(req.params.id), user(req).id);
    const after = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(req.query.afterSeq ?? 0);
    res.json({
      revision: view.revision,
      events: view.events.filter((e) => e.seq > after),
    });
  });
  app.post("/api/rooms/:id/commands", async (req, res) => {
    const account = user(req);
    limit(`cmd:${account.id}`, 60);
    const command = commandInput.parse(req.body);
    if (command.type === "character")
      command.data = characterInput.parse(command.data);
    else if (command.type === "action")
      command.data = actionInput.parse(command.data);
    else if (command.type === "roll")
      command.data = z
        .object({ checkId: z.string().uuid() })
        .strict()
        .parse(command.data);
    else if (command.type === "vote")
      command.data = z
        .object({ approve: z.boolean() })
        .strict()
        .parse(command.data);
    else command.data = z.object({}).strict().parse(command.data);
    await engine.execute(String(req.params.id), account.id, command);
    res.json(engine.view(String(req.params.id), account.id));
  });
  app.post("/api/rooms/:id/chat", (req, res) => {
    const account = user(req);
    limit(`chat:${account.id}`, 30);
    const id = String(req.params.id);
    engine.view(id, account.id);
    const { text } = z
      .object({ text: z.string().trim().min(1).max(500) })
      .strict()
      .parse(req.body);
    store.addChat(id, account.id, account.name, text);
    engine.onChange(id);
    res.json({ ok: true });
  });
  io.use((socket, next) => {
    const account = store.user(cookie(socket.request.headers.cookie));
    if (!account) {
      next(new Error("登入已失效"));
      return;
    }
    socket.data.user = account;
    next();
  });
  io.on("connection", (socket) => {
    socket.on("watch", (id: unknown, ack?: (data: unknown) => void) => {
      try {
        limit(`watch:${socket.data.user.id}`, 60);
        if (typeof id !== "string")
          throw new GameError(400, "房間編號格式錯誤");
        const view = engine.view(id, socket.data.user.id);
        if (socket.data.roomId && socket.data.roomId !== id)
          engine.setConnected(socket.data.roomId, socket.data.user.id, false);
        if (socket.data.roomId !== id) {
          socket.data.roomId = id;
          engine.setConnected(id, socket.data.user.id, true);
        }
        socket.emit("state", engine.view(view.id, socket.data.user.id));
        if (typeof ack === "function") ack({ ok: true });
      } catch (error) {
        if (typeof ack === "function")
          ack({ error: error instanceof Error ? error.message : "無法加入" });
      }
    });
    socket.on("disconnect", () => {
      if (socket.data.roomId)
        engine.setConnected(socket.data.roomId, socket.data.user.id, false);
    });
  });
  engine.onChange = (id) => {
    for (const socket of io.sockets.sockets.values())
      if (socket.data.roomId === id) {
        try {
          socket.emit("state", engine.view(id, socket.data.user.id));
        } catch {
          socket.disconnect(true);
        }
      }
  };
  const interval = setInterval(() => {
    try {
      engine.tick();
    } catch (error) {
      console.error(
        "Session recovery failed",
        error instanceof Error ? error.name : "error",
      );
    }
  }, 1000);
  interval.unref();
  const dist = config.dist ?? resolve("dist");
  app.use("/api", (_req, res) => res.status(404).json({ error: "找不到 API" }));
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(dist, "index.html")),
    );
  }
  app.use(
    (
      error: unknown,
      _req: Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "輸入格式不正確，請檢查欄位與數值" });
        return;
      }
      if (error instanceof GameError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof SyntaxError) {
        res.status(400).json({ error: "JSON 格式不正確" });
        return;
      }
      console.error(
        "Request failed",
        error instanceof Error ? error.name : "error",
      );
      res.status(500).json({ error: "伺服器暫時無法完成操作，請重新載入狀態" });
    },
  );
  return {
    app,
    http,
    io,
    engine,
    store,
    close: async () => {
      clearInterval(interval);
      await new Promise<void>((resolve) => io.close(() => resolve()));
      store.close();
    },
  };
}
