import { sql } from "drizzle-orm";
import { schema } from "../db";

export const effectivePaymentVatRate = (userId: string) => sql<number>`(
  select case when ${schema.users.vatRegistered} then coalesce(${schema.users.vatRateBp}, 0) else 0 end
  from ${schema.users} where ${schema.users.id} = ${userId}
)`;
