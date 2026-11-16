import type { Booking, Service } from "@sorted/core";
import { centsToInput } from "./format";

export function bookingServiceChips(saved: readonly Service[], bookings: readonly Pick<Booking, "service" | "priceCents" | "createdAt">[]): Service[] {
  const recent = [...bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((booking): booking is typeof booking & { priceCents: number } => booking.priceCents !== null)
    .map(booking => ({ name: booking.service.trim(), priceCents: booking.priceCents }));
  const seen = new Set<string>();
  return [...saved, ...recent].filter(service => {
    const name = service.name.trim().toLowerCase();
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  }).slice(0, 6);
}

export function serviceChipPrice(price: string, fromChip: boolean, service: Service) {
  return !price.trim() || fromChip
    ? { price: centsToInput(service.priceCents), fromChip: true }
    : { price, fromChip: false };
}
