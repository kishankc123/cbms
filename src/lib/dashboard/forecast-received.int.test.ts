import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, receivedCheques, salesInvoices } from "@/db/schema";
import { createTempOrg } from "@/test/temp-org";
import { todayIso } from "@/lib/calendar";
import { closeReceived, depositReceived, receiveCheque } from "@/lib/cheques/received";
import { addDays, loadForecast } from "./forecast";

// A cheque from a customer is money coming in on its date, so the invoices it will settle are not forecast a second time.

let org: Awaited<ReturnType<typeof createTempOrg>>;
let customerId: string;
const today = todayIso();
const inflow = async (days = 40) => {
  const r = await loadForecast(org.tenantId, today, days);
  const by = (key: string) => r.forecast.byCategory.find((c) => c.key === key)?.amount ?? 0;
  return { r, collections: by("collections"), held: by("cheques_received"), totalIn: r.forecast.totalIn };
};
const invoice = (n: string, due: number, total: number, daysAgo: number) =>
  db.insert(salesInvoices).values({ tenantId: org.tenantId, customerId, invoiceNumber: n, invoiceDate: addDays(today, -daysAgo), dueDate: addDays(today, due), subtotal: String(total), taxAmount: "0", total: String(total), status: "sent", amountPaid: "0" });
const cheque = (n: string, amount: number, dueIn: number) => receiveCheque(org.tenantId, org.userId, { customerId, drawerBank: "Nabil Bank", chequeNumber: n, amount, receivedDate: today, chequeDate: addDays(today, dueIn), memo: null }, today);

beforeAll(async () => {
  org = await createTempOrg("ZZ Forecast Received");
  const [c] = await db.insert(customers).values({ tenantId: org.tenantId, name: "Held Cheque Customer" }).returning();
  customerId = c.id;
  await invoice("INV-1", 10, 30000, 30);
  await invoice("INV-2", 20, 20000, 20);
});
afterAll(async () => {
  await db.delete(receivedCheques).where(eq(receivedCheques.tenantId, org.tenantId));
  await org.remove();
});

describe("received cheques in the cash forecast", () => {
  it("forecasts the invoices on their due dates when no cheque is held", async () => {
    const f = await inflow();
    expect(f.collections).toBe(50000);
    expect(f.held).toBe(0);
    expect(f.r.receivedCheques.count).toBe(0);
  });

  it("swaps the invoice a held cheque will settle for the cheque, so money in is not counted twice", async () => {
    await cheque("990001", 30000, 10);
    const f = await inflow();
    expect(f.held).toBe(30000);
    expect(f.collections).toBe(20000); // INV-1, the oldest, is covered
    expect(f.totalIn).toBe(50000);
    expect(f.r.receivedCheques).toMatchObject({ count: 1, amount: 30000 });
  });

  it("covers the next invoice part way when the cheque is smaller than what is owed", async () => {
    await cheque("990002", 10000, 20);
    const f = await inflow();
    expect(f.held).toBe(40000);
    expect(f.collections).toBe(10000);
    expect(f.totalIn).toBe(50000);
  });

  it("still counts a cheque once it is deposited", async () => {
    const [c] = await db.select().from(receivedCheques).where(eq(receivedCheques.chequeNumber, "990001"));
    // Deposit needs the cheque date to have come; move it back for the test.
    await db.update(receivedCheques).set({ chequeDate: today }).where(eq(receivedCheques.id, c.id));
    const { chequeBankAccounts } = await import("@/lib/cheques/cheques");
    await depositReceived(org.tenantId, c.id, (await chequeBankAccounts(org.tenantId))[0].id, today, today);
    const f = await inflow();
    expect(f.held).toBe(40000);
  });

  it("stops counting a cheque once it is given back, and the invoice returns to its due date", async () => {
    const [c] = await db.select().from(receivedCheques).where(eq(receivedCheques.chequeNumber, "990002"));
    await closeReceived(org.tenantId, org.userId, c.id, "returned", "Paid in cash");
    const f = await inflow();
    expect(f.held).toBe(30000);
    expect(f.collections).toBe(20000);
    expect(f.totalIn).toBe(50000);
  });
});
