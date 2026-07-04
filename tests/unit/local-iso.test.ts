import { describe, expect, test } from "bun:test";
import {
  formatLocalDateTime,
  formatLocalDateTimeWithOffset,
} from "../../extensions/my-stuff/lib/local-iso.js";

describe("local ISO helpers", () => {
  test("formats local timestamps without a timezone suffix", () => {
    const date = {
      getFullYear: () => 2026,
      getMonth: () => 5,
      getDate: () => 21,
      getHours: () => 8,
      getMinutes: () => 34,
      getSeconds: () => 56,
      getTimezoneOffset: () => 240,
    } as Date;

    expect(formatLocalDateTime(date)).toBe("2026-06-21T08:34:56");
    expect(formatLocalDateTime(date, " ")).toBe("2026-06-21 08:34:56");
  });

  test("formats local timestamps with the local UTC offset when requested", () => {
    const date = {
      getFullYear: () => 2026,
      getMonth: () => 5,
      getDate: () => 21,
      getHours: () => 8,
      getMinutes: () => 34,
      getSeconds: () => 56,
      getTimezoneOffset: () => 330,
    } as Date;

    expect(formatLocalDateTimeWithOffset(date)).toBe("2026-06-21T08:34:56-05:30");
  });
});
