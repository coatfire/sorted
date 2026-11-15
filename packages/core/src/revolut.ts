import { z } from "zod";

export const RevolutLink = z.string().trim().max(200).transform((value) =>
  value.replace(/^(?:https:\/\/)?revolut\.me\//i, "").replace(/^@/, ""),
).refine((name) => /^[A-Za-z0-9._-]+$/.test(name), "Enter a Revolut username or revolut.me link.")
  .transform((name) => `https://revolut.me/${name}`);
