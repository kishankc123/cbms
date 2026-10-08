import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/db";
import { emailLog } from "@/db/schema";
import { isDeliveryFailure, sendEmail } from "./email";
import { emailLog24h, listEmailLog, verificationEmailProblem } from "./email-log";

const TAG = `ztest-${Date.now()}`;
const addr = (n: string) => `${TAG}-${n}@example.com`;
const mail = (to: string, kind: "verification" | "invitation" = "verification") => ({ to, subject: "Verify your email", html: "<p>secret-link-body</p>", text: "secret-link-body https://x/verify/TOKEN", kind });
const original = { key: process.env.RESEND_API_KEY, fetch: globalThis.fetch };
const rowsFor = (to: string) => db.select().from(emailLog).where(eq(emailLog.toEmail, to.toLowerCase()));

beforeAll(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  if (original.key === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = original.key;
  globalThis.fetch = original.fetch;
});
afterAll(async () => {
  await db.delete(emailLog).where(like(emailLog.toEmail, `${TAG}%`));
  vi.restoreAllMocks();
});

describe("the sent-mail log", () => {
  it("with no email service, says so and logs it as not sent", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await sendEmail(mail(addr("a")));
    expect(r).toMatchObject({ delivered: false, status: "not_configured" });
    const [row] = await rowsFor(addr("a"));
    expect(row).toMatchObject({ status: "not_configured", kind: "verification", subject: "Verify your email" });
  });

  it("a delivered email is logged with the provider's id, and never keeps the message or its links", async () => {
    process.env.RESEND_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: "msg_123" }), { status: 200 })) as typeof fetch;
    const r = await sendEmail({ ...mail(addr("B")), tenantId: null });
    expect(r).toEqual({ delivered: true, status: "sent", error: undefined });
    const [row] = await rowsFor(addr("b")); // stored lowercased
    expect(row).toMatchObject({ status: "sent", providerId: "msg_123", error: null });
    expect(JSON.stringify(row)).not.toMatch(/secret-link-body|TOKEN/);
  });

  it("a refusal from the provider comes back with its reason, and is logged as failed", async () => {
    process.env.RESEND_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: "You can only send testing emails to your own email address." }), { status: 403 })) as typeof fetch;
    const r = await sendEmail(mail(addr("c")));
    expect(r).toMatchObject({ delivered: false, status: "failed", error: expect.stringContaining("only send testing emails") });
    expect((await rowsFor(addr("c")))[0]).toMatchObject({ status: "failed", error: expect.stringContaining("403") });
  });

  it("a network failure never throws: it is a failure with a reason", async () => {
    process.env.RESEND_API_KEY = "test-key";
    globalThis.fetch = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.resend.com");
    }) as typeof fetch;
    const r = await sendEmail(mail(addr("d")));
    expect(r).toMatchObject({ delivered: false, status: "failed", error: expect.stringContaining("Could not reach the email service") });
    expect((await rowsFor(addr("d")))[0].status).toBe("failed");
  });

  it("what counts as a delivery problem: a failure always, a missing service only on the live site", () => {
    const env = process.env as Record<string, string | undefined>;
    const was = env.NODE_ENV;
    expect(isDeliveryFailure("sent")).toBe(false);
    expect(isDeliveryFailure("failed")).toBe(true);
    env.NODE_ENV = "development";
    expect(isDeliveryFailure("not_configured")).toBe(false);
    env.NODE_ENV = "production";
    expect(isDeliveryFailure("not_configured")).toBe(true);
    env.NODE_ENV = was;
  });

  it("the verify banner reports a failed verification email, until a later one goes", async () => {
    process.env.RESEND_API_KEY = "test-key";
    const to = addr("e");
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: "Domain not verified" }), { status: 422 })) as typeof fetch;
    await sendEmail(mail(to));
    expect(await verificationEmailProblem(to)).toMatch(/Domain not verified/);
    // another kind of email does not hide it
    await sendEmail(mail(to, "invitation"));
    expect(await verificationEmailProblem(to)).toMatch(/Domain not verified/);
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 })) as typeof fetch;
    await sendEmail(mail(to));
    expect(await verificationEmailProblem(to)).toBeNull();
  });

  it("the platform list filters by outcome and counts the last day", async () => {
    const failed = await listEmailLog({ status: "failed", search: TAG, page: 1, pageSize: 50 });
    expect(failed.total).toBeGreaterThanOrEqual(3);
    expect(failed.rows.every((r) => r.status === "failed" && r.toEmail.startsWith(TAG))).toBe(true);
    const day = await emailLog24h();
    expect(day.sent).toBeGreaterThanOrEqual(2);
    expect(day.failed).toBeGreaterThanOrEqual(3);
  });
});
