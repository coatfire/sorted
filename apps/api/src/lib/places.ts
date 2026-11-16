import { z } from "zod";
import { PLACE_SUGGESTION_LIMIT, type PlaceSuggestion } from "@sorted/core";

const text = z.object({ text: z.string().min(1) });
const Predictions = z.object({
  suggestions: z.array(z.object({
    placePrediction: z.object({
      text,
      structuredFormat: z.object({ mainText: text, secondaryText: text.optional() }).optional(),
    }).optional(),
  })).default([]),
});

// The island of Ireland, so a venue across the border is found and one in England isn't.
const IRELAND = { rectangle: { low: { latitude: 51.3, longitude: -10.8 }, high: { latitude: 55.5, longitude: -5.3 } } };

/** Address and venue predictions from Google's Places API (New). Throws when Google can't be read. */
export async function searchPlaces(input: string, key: string): Promise<PlaceSuggestion[]> {
  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text",
    },
    body: JSON.stringify({ input, locationRestriction: IRELAND, languageCode: "en-IE", regionCode: "ie" }),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`Places search answered ${response.status}`);
  const { suggestions } = Predictions.parse(await response.json());
  return suggestions.flatMap(({ placePrediction: place }) => place ? [{
    text: place.text.text,
    main: place.structuredFormat?.mainText.text ?? place.text.text,
    secondary: place.structuredFormat?.secondaryText?.text ?? "",
  }] : []).slice(0, PLACE_SUGGESTION_LIMIT);
}
