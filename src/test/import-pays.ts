import type { PaySlot } from "@/lib/import-payments";

// Payment columns of an imported row, for the tests of the three imports' row checks.
export const slot = (over: Partial<PaySlot> = {}): PaySlot => ({ amount: { value: null, invalid: false }, account: "none", accountText: "", accountId: null, modeId: null, ...over });
export const noPays = [slot(), slot(), slot()];
/** The first payment filled in (an amount and the account it names), the others blank. */
export const pays = (value: number | null, account: PaySlot["account"] = "none", accountText = ""): PaySlot[] => [slot({ amount: { value, invalid: false }, account, accountText }), slot(), slot()];
