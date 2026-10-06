import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Fails when a page or a server action is added without a permission check. This is what stops the next screen
// from being open to every signed-in member by accident.

const SRC = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
function walk(dir: string, match: (name: string) => boolean, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, match, out);
    else if (match(e.name)) out.push(p);
  }
  return out;
}
const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, "/");

const GUARD = /\bcan\(|requireOrgAdmin|isOrgAdmin|requirePlatformAdmin|\bguard\(|requirePermission/;

describe("every page checks who may see it", () => {
  const pages = walk(path.join(SRC, "app/(app)"), (n) => n === "page.tsx");

  it("finds the pages", () => {
    expect(pages.length).toBeGreaterThan(80);
  });

  // Pages that carry no data of their own: they send the visitor somewhere else, which does the check.
  const NO_DATA = (s: string) => /redirect\(/.test(s) && !/\bdb\b/.test(s);

  for (const file of pages) {
    it(rel(file), () => {
      const s = read(file);
      if (NO_DATA(s)) return;
      expect(s, "no permission check").toMatch(/guardView\(|\bcan\(|isOrgAdmin\(/);
      // A guardView must be the first thing the page does, before it reads anything.
      if (/guardView\(/.test(s)) {
        const body = s.slice(s.search(/export default async function[^\n]*\{\n/));
        const firstStatement = body.split("\n").slice(1).find((l) => l.trim() !== "") ?? "";
        expect(firstStatement, "the guard must come first").toMatch(/guardView\(/);
      }
    });
  }
});

describe("every platform administration page checks for a platform administrator", () => {
  // The layout redirects non-admins, but a layout is not a security boundary, so each page checks for itself.
  const pages = walk(path.join(SRC, "app/admin"), (n) => n === "page.tsx");

  it("finds the pages", () => {
    expect(pages.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of pages) {
    it(rel(file), () => {
      const s = read(file);
      if (!/\bdb\b/.test(s) && !/export default async function/.test(s)) return; // a static placeholder with no data
      expect(s, "no platform administrator check").toMatch(/requirePlatformAdmin\(/);
    });
  }
});

describe("every server action checks who may call it", () => {
  const files = walk(path.join(SRC, "app"), (n) => /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)).filter((f) => /^\s*["']use server["']/.test(read(f)));

  // Sign-in, sign-up and account flows that run before an organization exists, so there is no module to check.
  const PUBLIC_FILES = new Set([
    "app/accept-invite/actions.ts",
    "app/forgot-password/actions.ts",
    "app/register/actions.ts",
    "app/register/user/actions.ts",
    "app/reset-password/[token]/actions.ts",
    "app/select-organization/actions.ts",
    "app/verify-email/actions.ts",
    "app/membership-notice-actions.ts",
    "app/theme-actions.ts",
    "app/(app)/fiscal-year-actions.ts",
  ]);
  // Delegates to a function that does the check itself.
  const DELEGATES = new Set(["app/(app)/payments/actions.ts#exportPaymentsCsv"]);

  it("finds the action files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const name = rel(file);
    if (PUBLIC_FILES.has(name)) continue;
    it(name, () => {
      const parts = read(file).split(/\nexport async function /).slice(1);
      const unchecked: string[] = [];
      for (const part of parts) {
        const fn = part.match(/^(\w+)/)![1];
        const end = part.indexOf("\n}\n");
        const body = end >= 0 ? part.slice(0, end) : part;
        if (!GUARD.test(body) && !DELEGATES.has(`${name}#${fn}`)) unchecked.push(fn);
      }
      expect(unchecked, "server actions without a permission check").toEqual([]);
    });
  }

  // Platform administration works on any organization by design, and every action there checks requirePlatformAdmin.
  const PLATFORM_ADMIN_FILE = (name: string) => name.startsWith("app/admin/");

  it("none takes a tenantId from the caller (anyone could pass another organization's)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const m of read(file).matchAll(/export async function (\w+)\(([^)]*)\)/g)) {
        if (/\btenantId\b/.test(m[2]) && !PLATFORM_ADMIN_FILE(rel(file)) && !(rel(file) === "app/select-organization/actions.ts" && m[1] === "switchOrganization")) offenders.push(`${rel(file)}#${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
