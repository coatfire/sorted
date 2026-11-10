import { SignJWT, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import { env } from "./env";

const secret = () => new TextEncoder().encode(env.jwtSecret());

export async function issueJwt(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, purpose: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function issueMagicLinkToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, purpose: "magic-link" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret());
}

export async function verifyMagicLinkToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secret());
  if (payload.purpose !== "magic-link" || !payload.sub) {
    throw new Error("Invalid magic link");
  }
  return String(payload.sub);
}

/** Sets c.get("userId") or returns 401. Applied to all /api/* routes. */
export const requireAuth: MiddlewareHandler<{
  Variables: { userId: string };
}> = async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== "session") {
      return c.json({ error: "Unauthorized" }, 401);
    }
    c.set("userId", String(payload.sub));
    await next();
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
};

/** For /internal/* routes called by n8n. */
export const requireInternalSecret: MiddlewareHandler = async (c, next) => {
  const secret = env.internalSecret();
  // An unset secret must lock the routes, not match an empty header.
  if (!secret || c.req.header("X-Internal-Secret") !== secret) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
};
