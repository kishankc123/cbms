// A sale with no customer is posted to a customer called "Cash Sale", made the first time it is needed. It is a stand-in for walk-in
// buyers who pay on the spot, not someone who owes anything, so lists of real (credit) customers leave it out.
export const CASH_SALE_CUSTOMER_NAME = "Cash Sale";

export const isCashSaleCustomer = (name: string | null | undefined) => (name ?? "").trim().toLowerCase() === CASH_SALE_CUSTOMER_NAME.toLowerCase();
