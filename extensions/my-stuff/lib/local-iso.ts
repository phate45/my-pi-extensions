type LocalDateLike = Pick<
  Date,
  | "getFullYear"
  | "getMonth"
  | "getDate"
  | "getHours"
  | "getMinutes"
  | "getSeconds"
  | "getTimezoneOffset"
>;

function pad2(value: number): string {
  return String(Math.trunc(Math.abs(value))).padStart(2, "0");
}

export function formatLocalDateTime(date: LocalDateLike, separator = "T"): string {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return `${year}-${month}-${day}${separator}${hours}:${minutes}:${seconds}`;
}

export function formatLocalDateTimeWithOffset(date: LocalDateLike): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = pad2(offsetMinutes / 60);
  const offsetRemainder = pad2(offsetMinutes % 60);
  return `${formatLocalDateTime(date)}${sign}${offsetHours}:${offsetRemainder}`;
}
