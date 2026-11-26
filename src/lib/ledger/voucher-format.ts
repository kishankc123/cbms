// The look of a manual journal voucher number, kept apart from the counter (voucher.ts) so screens can use it without the database.
export const VOUCHER_PREFIX = "JV-";
export const formatVoucher = (n: number) => `${VOUCHER_PREFIX}${String(n).padStart(4, "0")}`;
