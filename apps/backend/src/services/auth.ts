export type UserPlan = "free" | "pro" | "power";

export type AuthenticatedUser = {
  token: string;
  plan: UserPlan;
};

const DEFAULT_DEV_TOKEN = "dev-local-token";

function normalizePlan(value: string | undefined): UserPlan {
  if (value === "pro" || value === "power") return value;
  return "free";
}

export function parseAuthToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export function authenticateToken(token: string | null): AuthenticatedUser | null {
  if (!token) return null;

  const configuredTokens = (process.env.AUTH_TOKENS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of configuredTokens) {
    const [configuredToken, configuredPlan] = entry.split(":", 2);
    if (configuredToken === token) {
      return { token, plan: normalizePlan(configuredPlan) };
    }
  }

  if (process.env.NODE_ENV !== "production" && token === DEFAULT_DEV_TOKEN) {
    return { token, plan: "pro" };
  }

  return null;
}

export const authInternals = { normalizePlan, DEFAULT_DEV_TOKEN };
