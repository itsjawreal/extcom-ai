import type { UserPlan } from "./auth.js";

type UsageWindow = {
  dayKey: string;
  dayCount: number;
  minuteKey: string;
  minuteCount: number;
};

type RateLimitConfig = {
  perMinute: number;
  perDay: number;
};

export type UsageSnapshot = {
  allowed: boolean;
  remainingToday: number;
  retryAfterSeconds?: number;
};

const PLAN_LIMITS: Record<UserPlan, RateLimitConfig> = {
  free: { perMinute: 5, perDay: 20 },
  pro: { perMinute: 30, perDay: 300 },
  power: { perMinute: 60, perDay: 1000 },
};

const usageByToken = new Map<string, UsageWindow>();

function getDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getMinuteKey(date: Date): string {
  return date.toISOString().slice(0, 16);
}

export function consumeRateLimit(token: string, plan: UserPlan, now = new Date()): UsageSnapshot {
  const limits = PLAN_LIMITS[plan];
  const dayKey = getDayKey(now);
  const minuteKey = getMinuteKey(now);
  const current = usageByToken.get(token);

  const usage: UsageWindow = current && current.dayKey === dayKey
    ? current
    : { dayKey, dayCount: 0, minuteKey, minuteCount: 0 };

  if (usage.minuteKey !== minuteKey) {
    usage.minuteKey = minuteKey;
    usage.minuteCount = 0;
  }

  if (usage.dayCount >= limits.perDay) {
    usageByToken.set(token, usage);
    return { allowed: false, remainingToday: 0, retryAfterSeconds: 86_400 };
  }

  if (usage.minuteCount >= limits.perMinute) {
    usageByToken.set(token, usage);
    return {
      allowed: false,
      remainingToday: Math.max(0, limits.perDay - usage.dayCount),
      retryAfterSeconds: 60,
    };
  }

  usage.dayCount += 1;
  usage.minuteCount += 1;
  usageByToken.set(token, usage);

  return {
    allowed: true,
    remainingToday: Math.max(0, limits.perDay - usage.dayCount),
  };
}

export function resetRateLimits(): void {
  usageByToken.clear();
}

export const rateLimitInternals = { PLAN_LIMITS };
