import type { IsoDate } from "@/lib/calendar";
import type { Period } from "./due-rules";

/** The single "period" of an event-based obligation: the day it happened. Keyed by the event, so it is raised once. */
export function eventPeriod(eventKey: string, label: string, eventDate: IsoDate): Period {
  return { key: `E:${eventKey}`, label, start: eventDate, end: eventDate };
}
