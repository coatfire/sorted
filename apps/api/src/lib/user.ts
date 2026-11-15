import type { schema } from "../db";

export function publicUser(user: typeof schema.users.$inferSelect) {
  const { passwordHash: _password, calendarToken: _calendarToken, googleSub: _googleSub, ...safe } = user;
  return safe;
}
