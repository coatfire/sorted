import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type User = typeof schema.users.$inferSelect;

// Row lock order: users → clients → bookings → payments → invoices.
// Lock multiple existing rows within a table by id; reuse locks already held.
export async function userTransaction<T>(userId: string, work: (tx: Transaction, user: User) => Promise<T>, retryUnique = false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async tx => {
        const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId)).for("share");
        if (!user) throw new Error("User not found");
        return work(tx, user);
      });
    } catch (error) {
      const code = error && typeof error === "object"
        ? ("code" in error ? error.code : "cause" in error && error.cause && typeof error.cause === "object" && "code" in error.cause ? error.cause.code : null)
        : null;
      if ((code !== "40P01" && !(retryUnique && code === "23505")) || attempt >= 2) throw error;
    }
  }
}

export async function lockBookingWithClient(tx: Transaction, userId: string, bookingId: string) {
  const [owner] = await tx.select({ client: schema.clients }).from(schema.clients)
    .innerJoin(schema.bookings, eq(schema.bookings.clientId, schema.clients.id))
    .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.userId, userId), eq(schema.clients.userId, userId)))
    .for("share", { of: schema.clients });
  if (!owner) return undefined;
  const [booking] = await tx.select().from(schema.bookings)
    .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.userId, userId), eq(schema.bookings.clientId, owner.client.id)))
    .for("update");
  return booking ? { booking, client: owner.client } : undefined;
}
