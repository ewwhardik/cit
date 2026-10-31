import { describe, expect, it } from "vitest";
import { periodForHour, periodRange, periodStartHour } from "./time";

describe("period clock mapping", () => {
  it("maps periods around lunch", () => {
    expect(periodStartHour(1)).toBe(8);
    expect(periodStartHour(5)).toBe(12);
    expect(periodStartHour(6)).toBe(14);
    expect(periodStartHour(10)).toBe(18);
    expect(periodStartHour(13)).toBe(21);
  });
  it("inverts clock hours, including evening event periods", () => {
    expect(periodForHour(18)).toBe(10); // "shaam 6 baje"
    expect(periodForHour(13)).toBeNull(); // lunch
    expect(periodForHour(22)).toBeNull();
    for (let p = 1; p <= 13; p++) expect(periodForHour(periodStartHour(p))).toBe(p);
  });
  it("formats inclusive ranges", () => {
    expect(periodRange(10, 11)).toBe("18:00–20:00");
    expect(periodRange(4, 5)).toBe("11:00–13:00");
  });
});
