export type Stat = "strength" | "agility" | "insight";
export type Race = "human" | "elf" | "dwarf";
export type Job = "guardian" | "ranger" | "arcanist";
export type SceneId = "harbor" | "marsh" | "tower";
export type Intent =
  | "observe"
  | "talk"
  | "interact"
  | "attack"
  | "skill"
  | "defend"
  | "heal"
  | "move"
  | "pass";
export type Outcome =
  "critical_failure" | "failure" | "success" | "critical_success";
export interface Character {
  name: string;
  race: Race;
  job: Job;
  stats: Record<Stat, number>;
  hp: number;
  maxHp: number;
  potions: number;
  focus: number;
  gold: number;
  xp: number;
  level: number;
  equipment: string[];
  confused: number;
}
export interface Member {
  userId: string;
  displayName: string;
  character: Character | null;
  ready: boolean;
}
export interface GameEvent {
  seq: number;
  at: string;
  kind: "gm" | "system" | "roll" | "action";
  text: string;
  userId?: string;
}
export interface PendingCheck {
  id: string;
  actorId: string;
  intent: Intent;
  stat: Stat;
  dc: number;
  modifier: number;
  label: string;
}
export interface Vote {
  target: SceneId;
  initiator: string;
  required: string[];
  approvals: string[];
  expiresAt: number;
}
export interface Session {
  quest: number;
  scene: SceneId;
  visited: SceneId[];
  flags: string[];
  enemyHp: number;
  enemyMaxHp: number;
  combat: boolean;
  turnOrder: string[];
  turnIndex: number;
  pending: PendingCheck | null;
  vote: Vote | null;
  busy: { id: string; actorId: string; startedAt: number } | null;
  aiCalls: number;
  aiTokensReserved: number;
}
export interface Room {
  id: string;
  mode: "solo" | "coop";
  hostId: string;
  members: Member[];
  phase: "lobby" | "playing" | "won" | "lost";
  revision: number;
  contentVersion: string;
  session: Session | null;
  events: GameEvent[];
  createdAt: string;
}
export interface Presence {
  userId: string;
  online: boolean;
  offlineSince: number | null;
}
export interface Chat {
  id: number;
  userId: string;
  name: string;
  text: string;
  at: string;
}
export interface RoomView extends Omit<Room, "session"> {
  session:
    | (Omit<Session, "flags" | "aiTokensReserved"> & {
        clues: number;
        objectiveReady: boolean;
      })
    | null;
  presence: Presence[];
  chat: Chat[];
  aiMode: "rules" | "live";
  activeActorId: string | null;
}
export interface ActionInput {
  intent?: Intent;
  target?: SceneId;
  text?: string;
}
