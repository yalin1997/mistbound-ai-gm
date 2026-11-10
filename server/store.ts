import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { Chat, Room } from "../shared/types.js";

export class GameError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(room_id TEXT NOT NULL REFERENCES rooms(id), user_id TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(room_id,user_id,key));
      CREATE TABLE IF NOT EXISTS chats(id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES rooms(id), user_id TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  register(name: string, password: string) {
    if (this.db.prepare("SELECT id FROM users WHERE name=?").get(name))
      throw new GameError(409, "這個旅人名稱已有人使用");
    const id = randomUUID(),
      salt = randomBytes(16).toString("hex");
    this.db
      .prepare("INSERT INTO users VALUES(?,?,?,?)")
      .run(id, name, salt, scryptSync(password, salt, 64).toString("hex"));
    return { id, name };
  }
  login(name: string, password: string) {
    const row = this.db
      .prepare("SELECT * FROM users WHERE name=?")
      .get(name) as { id: string; salt: string; hash: string } | undefined;
    // Do the same expensive derivation for unknown names.
    const actual = scryptSync(password, row?.salt ?? "unknown-user-salt", 64);
    if (!row || !timingSafeEqual(actual, Buffer.from(row.hash, "hex")))
      throw new GameError(401, "名稱或密碼不正確");
    return { id: row.id, name };
  }
  issueSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM auth WHERE expires < ?").run(Date.now());
    this.db
      .prepare("INSERT INTO auth VALUES(?,?,?)")
      .run(this.hash(token), userId, Date.now() + 30 * 86400000);
    return token;
  }
  hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }
  user(token: string | undefined) {
    if (!token) return null;
    return (
      (this.db
        .prepare(
          "SELECT users.id, users.name FROM auth JOIN users ON users.id=auth.user_id WHERE auth.token=? AND expires>?",
        )
        .get(this.hash(token), Date.now()) as
        { id: string; name: string } | undefined) ?? null
    );
  }
  logout(token: string) {
    this.db.prepare("DELETE FROM auth WHERE token=?").run(this.hash(token));
  }
  rooms() {
    return (
      this.db.prepare("SELECT body FROM rooms").all() as { body: string }[]
    ).map((row) => JSON.parse(row.body) as Room);
  }
  get(id: string): Room {
    const row = this.db.prepare("SELECT body FROM rooms WHERE id=?").get(id) as
      { body: string } | undefined;
    if (!row) throw new GameError(404, "找不到這個冒險房間");
    return JSON.parse(row.body);
  }
  save(room: Room) {
    this.db
      .prepare(
        "INSERT INTO rooms VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
      )
      .run(room.id, JSON.stringify(room));
  }
  receipt(roomId: string, userId: string, key: string, fingerprint: string) {
    const row = this.db
      .prepare(
        "SELECT fingerprint FROM receipts WHERE room_id=? AND user_id=? AND key=?",
      )
      .get(roomId, userId, key) as { fingerprint: string } | undefined;
    if (row && row.fingerprint !== fingerprint)
      throw new GameError(409, "同一請求編號不能用於不同操作");
    return Boolean(row);
  }
  remember(roomId: string, userId: string, key: string, fingerprint: string) {
    this.db
      .prepare("INSERT INTO receipts VALUES(?,?,?,?)")
      .run(roomId, userId, key, fingerprint);
  }
  chat(roomId: string): Chat[] {
    return (
      this.db
        .prepare(
          "SELECT id,user_id as userId,name,text,at FROM chats WHERE room_id=? ORDER BY id DESC LIMIT 60",
        )
        .all(roomId) as unknown as Chat[]
    ).reverse();
  }
  addChat(roomId: string, userId: string, name: string, text: string) {
    this.db
      .prepare(
        "INSERT INTO chats(room_id,user_id,name,text,at) VALUES(?,?,?,?,?)",
      )
      .run(roomId, userId, name, text, new Date().toISOString());
  }
  close() {
    this.db.close();
  }
}
