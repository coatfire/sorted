/**
 * "Local" = not running on Lambda and not explicitly production. Local mode
 * is zero-config: embedded Postgres (PGlite), a dev JWT secret, and login
 * links returned straight to the browser instead of emailed.
 */
const isLocal =
  !process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.NODE_ENV !== "production";

const DEV_JWT_SECRET = "sorted-local-dev-secret-not-for-production";

// Fail fast on boot rather than mid-request.
export function assertEnv() {
  if (isLocal) return;
  const missing = ["DATABASE_URL", "JWT_SECRET"].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}

export const env = {
  isLocal: () => isLocal,
  jwtSecret: () => process.env.JWT_SECRET || (isLocal ? DEV_JWT_SECRET : ""),
  /** Where the PWA lives — used to build login links. */
  appUrl: () =>
    (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, ""),
  /** Comma-separated allowed CORS origins. Unset = allow all (dev). */
  corsOrigins: () =>
    process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean),
  n8nWebhookUrl: () => process.env.N8N_WEBHOOK_URL || undefined,
  internalSecret: () => process.env.INTERNAL_SECRET ?? "",
  stripeKey: () => process.env.STRIPE_SECRET_KEY || undefined,
  stripeWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET || undefined,
  resendKey: () => process.env.RESEND_API_KEY || undefined,
  emailFrom: () => process.env.EMAIL_FROM || "Sorted <login@sorted.app>",
};
