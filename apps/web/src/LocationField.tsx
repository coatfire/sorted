import { useEffect, useId, useRef, useState } from "react";
import { knownPlaces, PLACE_SEARCH_MIN, type PlaceSearchResult } from "@sorted/core";
import { Field, Icon } from "./components";
import { useData, useStore } from "./lib/store";

const SEARCH_PAUSE_MS = 350;

/** Free text, with one-tap suggestions: places used on earlier bookings, then address search when it's switched on. */
export function LocationField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { bookings, features } = useData();
  const { backend } = useStore();
  const list = useId();
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<{ input: string; result: PlaceSearchResult } | null>(null);
  const typed = value.trim();
  const searching = open && features.addressSearch && typed.length >= PLACE_SEARCH_MIN;

  useEffect(() => {
    if (!searching) return;
    let live = true;
    // Suggestions are an extra: when the search can't be reached, the field is still plain text.
    const timer = setTimeout(() => {
      backend.searchPlaces(typed).then((result) => { if (live) setFound({ input: typed, result }); }).catch(() => undefined);
    }, SEARCH_PAUSE_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [backend, searching, typed]);

  const known = open ? knownPlaces(bookings, value) : [];
  const taken = new Set([typed, ...known].map((place) => place.toLowerCase()));
  const result = searching && found?.input === typed ? found.result : null;
  const places = result?.suggestions.filter((place) => !taken.has(place.text.toLowerCase())) ?? [];
  const count = known.length + places.length;
  const pick = (place: string) => { onChange(place); setOpen(false); };

  // With the keyboard up there's little room under the field, so bring the suggestions above the keyboard.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const field = box.current, view = window.visualViewport;
    if (!count || !field) return;
    const visibleBottom = view ? view.offsetTop + view.height : window.innerHeight;
    if (field.getBoundingClientRect().bottom > visibleBottom) field.scrollIntoView({ block: "start" });
  }, [count]);

  return (
    <div className="place-field" ref={box} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <Field label="Location">
        <input
          name="location" value={value} autoComplete="off" aria-controls={count ? list : undefined}
          onChange={(event) => { onChange(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
          placeholder="Studio, venue or address"
        />
      </Field>
      {count > 0 && (
        // Keeping the press from moving focus leaves the keyboard up and the list open until the tap lands.
        <div className="place-list" id={list} role="group" aria-label="Suggested places" onMouseDown={(event) => event.preventDefault()}>
          {known.map((place) => (
            <button type="button" className="place-option" key={place} onClick={() => pick(place)}>
              <Icon name="clock" size={17} /><span><strong>{place}</strong><small>Used before</small></span>
            </button>
          ))}
          {places.map((place) => (
            <button type="button" className="place-option" key={place.text} onClick={() => pick(place.text)}>
              <Icon name="map" size={17} /><span><strong>{place.main}</strong>{place.secondary && <small>{place.secondary}</small>}</span>
            </button>
          ))}
          {places.length > 0 && (result?.source === "google"
            ? <p className="place-source is-google" translate="no">Google Maps</p>
            : <p className="place-source">Sample addresses</p>)}
        </div>
      )}
      <p className="visually-hidden" role="status">{count ? `${count} suggested ${count === 1 ? "place" : "places"} below` : ""}</p>
    </div>
  );
}
