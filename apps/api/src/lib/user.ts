import type { schema } from "../db";

export function publicUser(user: typeof schema.users.$inferSelect) {
  const { passwordHash: _password, ...safe } = user;
  return safe;
}
