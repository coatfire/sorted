import { z } from "zod";
import type { Booking } from "./types";

export const PLACE_SEARCH_MIN = 3;
export const KNOWN_PLACE_LIMIT = 3;
export const PLACE_SUGGESTION_LIMIT = 5;

export const PlaceSearchInput = z.object({ input: z.string().trim().min(PLACE_SEARCH_MIN).max(200) });

export interface PlaceSuggestion {
  /** What goes into the Location field. */
  text: string;
  main: string;
  secondary: string;
}

export interface PlaceSearchResult {
  /** "sample" is the demo's made-up list; nothing in it comes from Google. */
  source: "google" | "sample";
  suggestions: PlaceSuggestion[];
}

const words = (text: string) => text.toLowerCase().split(/[\s,]+/).filter(Boolean);

/** Locations the trader has used before that match what they've typed, most recently used first. */
export function knownPlaces(bookings: readonly Pick<Booking, "location" | "createdAt">[], input: string, limit = KNOWN_PLACE_LIMIT): string[] {
  const typed = input.trim().toLowerCase();
  const wanted = words(typed);
  const seen = new Set<string>([typed]);
  const places: string[] = [];
  for (const booking of [...bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const place = booking.location?.trim();
    if (!place || seen.has(place.toLowerCase())) continue;
    seen.add(place.toLowerCase());
    if (wanted.every((word) => place.toLowerCase().includes(word))) places.push(place);
    if (places.length === limit) break;
  }
  return places;
}
