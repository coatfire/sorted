import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { MiddlewareHandler } from "hono";
import { env } from "./env";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";

const secret = () => new TextEncoder().encode(env.jwtSecret());

export async function issueJwt(userId: string, sessionVersion: number): Promise<string> {
  return new SignJWT({ sub: userId, purpose: "session", sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function issueEmailToken(userId: string, tokenId: string): Promise<string> {
  return new SignJWT({ sub: userId, purpose: "email-link" })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(tokenId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret());
}

export async function verifyEmailToken(token: string): Promise<{ userId: string; tokenId: string }> {
  const { payload } = await jwtVerify(token, secret());
  if (payload.purpose !== "email-link" || !payload.sub || !payload.jti) {
    throw new Error("Invalid email link");
  }
  return { userId: payload.sub, tokenId: payload.jti };
}

/** Sets c.get("userId") or returns 401. Applied to all /api/* routes. */
export const requireAuth: MiddlewareHandler<{
  Variables: { userId: string };
}> = async (c, next) => {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, secret()));
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (payload.purpose !== "session" || !payload.sub || !Number.isInteger(payload.sv)) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const [user] = await db.select({ sessionVersion: schema.users.sessionVersion })
    .from(schema.users).where(eq(schema.users.id, payload.sub));
  if (!user || user.sessionVersion !== payload.sv) return c.json({ error: "Unauthorized" }, 401);
  c.set("userId", payload.sub);
  await next();
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
