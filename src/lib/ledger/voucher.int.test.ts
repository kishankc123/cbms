import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTempOrg } from "@/test/temp-org";
import { formatVoucher, issueVoucher, peekNextVoucher } from "./voucher";

let org: Awaited<ReturnType<typeof createTempOrg>>;
beforeAll(async () => {
  org = await createTempOrg("ZZ Voucher Test");
});
afterAll(async () => {
  await org.remove();
});

describe("journal voucher numbers", () => {
  it("formats with a fixed-width sequence", () => {
    expect(formatVoucher(1)).toBe("JV-0001");
    expect(formatVoucher(42)).toBe("JV-0042");
    expect(formatVoucher(12345)).toBe("JV-12345");
  });

  it("starts at JV-0001 and previews without using the number", async () => {
    expect(await peekNextVoucher(org.tenantId)).toBe("JV-0001");
    expect(await peekNextVoucher(org.tenantId)).toBe("JV-0001");
    expect(await issueVoucher(org.tenantId)).toBe("JV-0001");
    expect(await peekNextVoucher(org.tenantId)).toBe("JV-0002");
  });

  it("never repeats a number, even when issued at the same moment", async () => {
    const issued = await Promise.all(Array.from({ length: 8 }, () => issueVoucher(org.tenantId)));
    expect(new Set(issued).size).toBe(8);
  });
});
