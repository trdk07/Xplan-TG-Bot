import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysUntil, isPast, renewalBaseDate } from "@/lib/dates";

describe("date helpers", () => {
  it("adds days without mutating the source date", () => {
    const source = new Date("2026-04-27T00:00:00.000Z");
    const result = addDays(source, 3);

    expect(result.toISOString()).toBe("2026-04-30T00:00:00.000Z");
    expect(source.toISOString()).toBe("2026-04-27T00:00:00.000Z");
  });

  it("adds calendar months and clamps to the end of shorter months", () => {
    const source = new Date("2026-01-31T10:30:00.000Z");

    expect(addMonths(source, 1).toISOString()).toBe("2026-02-28T10:30:00.000Z");
    expect(addMonths(source, 3).toISOString()).toBe("2026-04-30T10:30:00.000Z");
    expect(source.toISOString()).toBe("2026-01-31T10:30:00.000Z");
  });

  it("uses the current due date as the renewal base when renewing early", () => {
    const now = new Date("2026-05-30T00:00:00.000Z");

    expect(
      renewalBaseDate("2026-06-15T00:00:00.000Z", now).toISOString(),
    ).toBe("2026-06-15T00:00:00.000Z");
    expect(
      renewalBaseDate("2026-05-01T00:00:00.000Z", now).toISOString(),
    ).toBe("2026-05-30T00:00:00.000Z");
    expect(renewalBaseDate(null, now).toISOString()).toBe(
      "2026-05-30T00:00:00.000Z",
    );
  });

  it("detects past timestamps", () => {
    const now = new Date("2026-04-27T12:00:00.000Z");

    expect(isPast("2026-04-27T11:59:59.000Z", now)).toBe(true);
    expect(isPast("2026-04-27T12:00:01.000Z", now)).toBe(false);
    expect(isPast(null, now)).toBe(false);
  });

  it("calculates days until a timestamp", () => {
    const now = new Date("2026-04-27T00:00:00.000Z");
    expect(daysUntil("2026-04-30T00:00:00.000Z", now)).toBe(3);
  });
});
