import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Goes one step beyond permission-coverage.test.ts. That test proves every server action HAS a check; this one proves the
// check matches what the action does, for the actions that destroy, reverse or reopen things:
//   - void / reverse / undo / cancel  -> the module's "void" permission (or an administrator)
//   - delete / remove                 -> the module's "delete" permission (or an administrator)
//   - reopen                          -> administrators only (always with a reason and an audit entry)
// An action that cannot follow the rule is listed below with the reason, so a new one cannot slip through unnoticed.

const SRC = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
function walk(dir: string, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, "/");

type Action = { id: string; file: string; fn: string; body: string };
const actions: Action[] = [];
for (const file of walk(path.join(SRC, "app")).filter((f) => /^\s*["']use server["']/.test(read(f)))) {
  for (const part of read(file).split(/\nexport async function /).slice(1)) {
    const fn = part.match(/^(\w+)/)![1];
    const end = part.indexOf("\n}\n");
    actions.push({ id: `${rel(file)}#${fn}`, file: rel(file), fn, body: end >= 0 ? part.slice(0, end) : part });
  }
}

const ADMIN = /requireOrgAdmin|isOrgAdmin|requirePlatformAdmin/;
const usesPermission = (body: string, action: string) => new RegExp(`can\\(\\s*session\\s*,\\s*"\\w+"\\s*,[^)]*"${action}"`).test(body) || new RegExp(`guard\\(\\s*"${action}"`).test(body);

/** Actions that do not follow the naming rule, with the reason. */
const EXCEPTIONS: Record<string, string> = {
  "app/(app)/bank-reconciliation/actions.ts#unmatch": "Bank Reconciliation has no Void permission; Edit is its strongest",
  "app/(app)/bank-reconciliation/actions.ts#classifyUnmatchedLedgerLine": "Bank Reconciliation has no Void permission; Edit is its strongest",
  "app/(app)/payroll/salary-sheet/actions.ts#reverseFinalizedRun": "Payroll has no Void permission, so any role with Edit and 'See salary amounts' can reverse a finalized run (review: consider a Payroll Void action)",
  "app/(app)/compliance/ownership-actions.ts#cancelShares": "a share-register transaction (a corporate action), not the voiding of a document",
  "app/(app)/compliance/excise-actions.ts#undoExciseRenewal": "undoes the latest renewal record on the permit; posts no money",
  "app/(app)/compliance/tax/vat-worksheet-actions.ts#discardVatWorksheetLoad": "throws away an unsaved draft, not a record",
};

describe("destructive actions require the matching permission", () => {
  it("finds the actions", () => {
    expect(actions.length).toBeGreaterThan(250);
  });

  it("void / reverse / undo / cancel need Void (or an administrator)", () => {
    const offenders = actions
      .filter((a) => /^(void|reverse|undo|cancel|unmatch)/i.test(a.fn) && !(a.id in EXCEPTIONS))
      .filter((a) => !usesPermission(a.body, "void") && !ADMIN.test(a.body))
      .map((a) => a.id);
    expect(offenders, "check can(session, <module>, \"void\"), or list the action in EXCEPTIONS with a reason").toEqual([]);
  });

  it("delete / remove need Delete (or an administrator)", () => {
    const offenders = actions
      .filter((a) => /^(delete|remove)/i.test(a.fn) && !(a.id in EXCEPTIONS))
      .filter((a) => !usesPermission(a.body, "delete") && !ADMIN.test(a.body))
      .map((a) => a.id);
    expect(offenders, "check can(session, <module>, \"delete\"), or list the action in EXCEPTIONS with a reason").toEqual([]);
  });

  it("reopen is administrators only", () => {
    const reopeners = actions.filter((a) => /^reopen/i.test(a.fn));
    expect(reopeners.length).toBeGreaterThanOrEqual(3); // period, reconciliation, fiscal year
    const offenders = reopeners.filter((a) => !ADMIN.test(a.body)).map((a) => a.id);
    expect(offenders, "reopening a closed period must be admin-only").toEqual([]);
  });

  it("every exception still exists (remove the line when the action is gone)", () => {
    const ids = new Set(actions.map((a) => a.id));
    expect(Object.keys(EXCEPTIONS).filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe("hand-over of ownership", () => {
  const handOver = actions.find((a) => a.fn === "handOverOwnership");
  it("exists in the users settings and is limited to the Owner", () => {
    expect(handOver, "handOverOwnership not found").toBeTruthy();
    expect(handOver!.body).toMatch(/requireOrgAdmin/);
    expect(handOver!.body).toMatch(/role !== "owner"/);
  });
});
