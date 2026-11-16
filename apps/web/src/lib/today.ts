import { calendarDaysBetween, dublinDateTime, irelandToday } from "@sorted/core";

const dateFormat = (options: Intl.DateTimeFormatOptions) => (value: string | Date | null) => value === null ? options.hour && !options.day ? "Time to be agreed" : "Date to be agreed" : new Intl.DateTimeFormat("en-IE", { ...options, timeZone: "Europe/Dublin" }).format(new Date(value));
export const irelandTime = dateFormat({ hour: "2-digit", minute: "2-digit", hour12: false });
export const irelandLongDay = dateFormat({ weekday: "long", day: "numeric", month: "long" });
export const irelandDayMonth = dateFormat({ day: "numeric", month: "short" });
const shortDate = dateFormat({ weekday: "short", day: "numeric", month: "short" });

export function irelandDayLabel(value: string | null, now = new Date()) {
  if (!value) return "Date to be agreed";
  const days = calendarDaysBetween(irelandToday(now), dublinDateTime(value).date);
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : shortDate(value);
}

export function appointmentWhen(startAt: string | null, now = new Date()) {
  if (!startAt) return "Date to be agreed";
  const minutes = Math.ceil((Date.parse(startAt) - now.getTime()) / 60000);
  if (minutes <= 0) return "Now";
  const day = irelandDayLabel(startAt, now);
  if (day !== "Today") return `${day}, ${irelandTime(startAt)}`;
  const count = minutes < 60 ? minutes : Math.ceil(minutes / 60);
  const unit = minutes < 60 ? "minute" : "hour";
  return `In ${count} ${unit}${count === 1 ? "" : "s"}`;
}
