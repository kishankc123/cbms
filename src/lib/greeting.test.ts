import { describe, expect, it } from "vitest";
import { greetingFor } from "./greeting";

// Nepal is UTC+5:45.
const at = (utc: string) => greetingFor(new Date(utc));

describe("greeting by the hour in Nepal", () => {
  it("morning from 5am to before noon", () => {
    expect(at("2026-10-06T23:15:00Z")).toBe("Good morning"); // 05:00
    expect(at("2026-10-07T05:59:00Z")).toBe("Good morning"); // 11:44
  });
  it("afternoon from noon to before 5pm", () => {
    expect(at("2026-10-07T06:15:00Z")).toBe("Good afternoon"); // 12:00
    expect(at("2026-10-07T11:00:00Z")).toBe("Good afternoon"); // 16:45
  });
  it("evening from 5pm through the night", () => {
    expect(at("2026-10-07T11:15:00Z")).toBe("Good evening"); // 17:00
    expect(at("2026-10-07T20:00:00Z")).toBe("Good evening"); // 01:45
  });
});
