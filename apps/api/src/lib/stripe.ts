import Stripe from "stripe";
import { env } from "./env";

export async function deactivatePaymentLink(linkId: string) {
  try {
    const key = env.stripeKey();
    if (!key) return;
    const stripe = new Stripe(key);
    await stripe.paymentLinks.update(linkId, { active: false });
  } catch {
    console.error("[payments] Stripe link deactivation failed", linkId);
  }
}
