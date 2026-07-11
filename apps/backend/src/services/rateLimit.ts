import type { UserPlan } from "./auth.js";
import {
  getUsageWindow,
  resetUsageWindows,
  saveUsageWindow,
  type StoredUsageWindow,
} from "./store.js";

type RateLimitConfig = {
  perMinute: number;
  perDay: number;
};

export type UsageSnapshot = {
  allowed: boolean;
  remainingToday: number;
  retryAfterSeconds?: number;
  limitedBy?: "minute" | "day";
};

const PLAN_LIMITS: Record<UserPlan, RateLimitConfig> = {
  free: { perMinute: 5, perDay: 20 },
  pro: { perMinute: 30, perDay: 300 },
  power: { perMinute: 60, perDay: 1000 },
};

function getDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getMinuteKey(date: Date): string {
  return date.toISOString().slice(0, 16);
}

function secondsUntilNextUtcDay(date: Date): number {
  const next = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
  return Math.max(1, Math.ceil((next - date.getTime()) / 1_000));
}

export function consumeRateLimit(token: string, plan: UserPlan, now = new Date()): UsageSnapshot {
  const limits = PLAN_LIMITS[plan];
  const dayKey = getDayKey(now);
  const minuteKey = getMinuteKey(now);
  const current = getUsageWindow(token);

  const usage: StoredUsageWindow = current && current.dayKey === dayKey
    ? current
    : { dayKey, dayCount: 0, minuteKey, minuteCount: 0 };

  if (usage.minuteKey !== minuteKey) {
    usage.minuteKey = minuteKey;
    usage.minuteCount = 0;
  }

  if (usage.dayCount >= limits.perDay) {
    saveUsageWindow(token, usage);
    return {
      allowed: false,
      remainingToday: 0,
      retryAfterSeconds: secondsUntilNextUtcDay(now),
      limitedBy: "day",
    };
  }

  if (usage.minuteCount >= limits.perMinute) {
    saveUsageWindow(token, usage);
    // Calculate seconds until the next minute boundary (accounting for
    // milliseconds to avoid off-by-one UX issues). E.g., if we're at 12:34:00.500,
    // we want to say "retry in 59s" not "60s".
    const retryAfterSeconds = Math.ceil((60000 - (now.getTime() % 60000)) / 1000);
    return {
      allowed: false,
      remainingToday: Math.max(0, limits.perDay - usage.dayCount),
      retryAfterSeconds: Math.max(1, retryAfterSeconds),
      limitedBy: "minute",
    };
  }

  usage.dayCount += 1;
  usage.minuteCount += 1;
  saveUsageWindow(token, usage);

  return {
    allowed: true,
    remainingToday: Math.max(0, limits.perDay - usage.dayCount),
  };
}

// Generation reserves quota before calling the provider. Release that
// reservation when the provider fails so users only pay for successful output.
export function refundRateLimit(token: string, reservedAt: Date): void {
  const current = getUsageWindow(token);
  if (!current || current.dayKey !== getDayKey(reservedAt)) return;

  current.dayCount = Math.max(0, current.dayCount - 1);
  if (current.minuteKey === getMinuteKey(reservedAt)) {
    current.minuteCount = Math.max(0, current.minuteCount - 1);
  }
  saveUsageWindow(token, current);
}

export function peekRateLimit(token: string, plan: UserPlan, now = new Date()): UsageSnapshot {
  const limits = PLAN_LIMITS[plan];
  const current = getUsageWindow(token);
  const dayCount = current && current.dayKey === getDayKey(now) ? current.dayCount : 0;
  return {
    allowed: dayCount < limits.perDay,
    remainingToday: Math.max(0, limits.perDay - dayCount),
  };
}

export function resetRateLimits(): void {
  resetUsageWindows();
}

export const rateLimitInternals = { PLAN_LIMITS };
