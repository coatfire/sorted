import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Health } from "@sorted/core";
import { env } from "./lib/env";
import { requireAuth, requireInternalSecret } from "./lib/auth";
import { authRoutes } from "./handlers/auth";
import { clientRoutes } from "./handlers/clients";
import { bookingRoutes } from "./handlers/bookings";
import { paymentRoutes } from "./handlers/payments";
import { expenseRoutes } from "./handlers/expenses";
import { reportRoutes } from "./handlers/reports";
import { webhookRoutes } from "./handlers/webhooks";
import { internalRoutes } from "./handlers/internal";

export type AppEnv = { Variables: { userId: string } };

export const app = new Hono<AppEnv>();

if (!process.env.VITEST) app.use(logger());
app.use("/api/*", cors({ origin: env.corsOrigins() ?? "*" }));

app.get("/api/health", (c) =>
  c.json<Health>({
    ok: true,
    features: {
      automation: Boolean(env.n8nWebhookUrl()),
      paymentLinks: Boolean(env.stripeKey()),
    },
  }),
);

// Public
app.route("/api/auth", authRoutes);
app.route("/api/webhooks", webhookRoutes);

// Authenticated
app.use("/api/clients/*", requireAuth);
app.use("/api/bookings/*", requireAuth);
app.use("/api/payments/*", requireAuth);
app.use("/api/expenses/*", requireAuth);
app.use("/api/reports/*", requireAuth);
app.route("/api/clients", clientRoutes);
app.route("/api/bookings", bookingRoutes);
app.route("/api/payments", paymentRoutes);
app.route("/api/expenses", expenseRoutes);
app.route("/api/reports", reportRoutes);

// n8n callbacks
app.use("/api/internal/*", requireInternalSecret);
app.route("/api/internal", internalRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  // Malformed JSON body
  if (err instanceof SyntaxError) return c.json({ error: "Invalid JSON body" }, 400);
  // Postgres 22P02: a path id that isn't a uuid — that resource doesn't exist
  const code =
    (err as { code?: string }).code ??
    (err as { cause?: { code?: string } }).cause?.code;
  if (code === "22P02") return c.json({ error: "Not found" }, 404);
  console.error(err);
  return c.json({ error: "Internal error" }, 500);
});
