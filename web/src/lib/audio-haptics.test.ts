import { describe, expect, it } from "vitest";
import { playBlip, playChime, playTick } from "./audio-haptics";

describe("audio-haptics", () => {
  it("safely no-ops when disabled without error", () => {
    expect(() => playTick(false)).not.toThrow();
    expect(() => playBlip(false)).not.toThrow();
    expect(() => playChime(false)).not.toThrow();
  });

  it("safely executes in environments without active AudioContext", () => {
    expect(() => playTick(true)).not.toThrow();
    expect(() => playBlip(true)).not.toThrow();
    expect(() => playChime(true)).not.toThrow();
  });
});
