import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { UserPlan } from "./auth.js";

export type StoredUser = {
  token: string;
  plan: UserPlan;
  label: string | null;
  createdAt: string;
};

export type StoredUsageWindow = {
  dayKey: string;
  dayCount: number;
  minuteKey: string;
  minuteCount: number;
};

let db: DatabaseSync | null = null;

function resolveDatabasePath(): string {
  if (process.env.NODE_ENV === "test") return ":memory:";
  return resolve(process.env.DATABASE_PATH || "data/ekskomen.db");
}

function getDb(): DatabaseSync {
  if (db) return db;

  const path = resolveDatabasePath();
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      token TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_windows (
      token TEXT PRIMARY KEY,
      day_key TEXT NOT NULL,
      day_count INTEGER NOT NULL,
      minute_key TEXT NOT NULL,
      minute_count INTEGER NOT NULL
    );
  `);
  return db;
}

function normalizePlan(value: unknown): UserPlan {
  return value === "pro" || value === "power" ? value : "free";
}

export function findUser(token: string): StoredUser | null {
  const row = getDb()
    .prepare("SELECT token, plan, label, created_at FROM users WHERE token = ?")
    .get(token) as
      | { token: string; plan: string; label: string | null; created_at: string }
      | undefined;
  if (!row) return null;
  return {
    token: row.token,
    plan: normalizePlan(row.plan),
    label: row.label,
    createdAt: row.created_at,
  };
}

export function createUser(plan: UserPlan, label?: string): StoredUser {
  const user: StoredUser = {
    token: `eks_${randomBytes(24).toString("base64url")}`,
    plan,
    label: label?.trim() || null,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare("INSERT INTO users (token, plan, label, created_at) VALUES (?, ?, ?, ?)")
    .run(user.token, user.plan, user.label, user.createdAt);
  return user;
}

export function listUsers(): StoredUser[] {
  const rows = getDb()
    .prepare("SELECT token, plan, label, created_at FROM users ORDER BY created_at DESC")
    .all() as Array<{ token: string; plan: string; label: string | null; created_at: string }>;
  return rows.map((row) => ({
    token: row.token,
    plan: normalizePlan(row.plan),
    label: row.label,
    createdAt: row.created_at,
  }));
}

export function getUsageWindow(token: string): StoredUsageWindow | null {
  const row = getDb()
    .prepare(
      "SELECT day_key, day_count, minute_key, minute_count FROM usage_windows WHERE token = ?",
    )
    .get(token) as
      | { day_key: string; day_count: number; minute_key: string; minute_count: number }
      | undefined;
  if (!row) return null;
  return {
    dayKey: row.day_key,
    dayCount: row.day_count,
    minuteKey: row.minute_key,
    minuteCount: row.minute_count,
  };
}

export function saveUsageWindow(token: string, usage: StoredUsageWindow): void {
  getDb()
    .prepare(`
      INSERT INTO usage_windows (token, day_key, day_count, minute_key, minute_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (token) DO UPDATE SET
        day_key = excluded.day_key,
        day_count = excluded.day_count,
        minute_key = excluded.minute_key,
        minute_count = excluded.minute_count
    `)
    .run(token, usage.dayKey, usage.dayCount, usage.minuteKey, usage.minuteCount);
}

export function resetUsageWindows(): void {
  getDb().exec("DELETE FROM usage_windows");
}
