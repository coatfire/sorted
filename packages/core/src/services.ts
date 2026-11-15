import { z } from "zod";

export const Service = z.object({
  name: z.string().trim().min(1, "Enter a service name.").max(200),
  priceCents: z.number().int().nonnegative().max(2_147_483_647),
});
export type Service = z.infer<typeof Service>;

export const Services = z.array(Service).max(30).refine(
  services => new Set(services.map(service => service.name.toLowerCase())).size === services.length,
  "Use a different name for each service.",
);

export const ServicesInput = z.array(z.object({ name: Service.shape.name, price_cents: Service.shape.priceCents }))
  .transform(services => services.map(service => ({ name: service.name, priceCents: service.price_cents }))).pipe(Services);
