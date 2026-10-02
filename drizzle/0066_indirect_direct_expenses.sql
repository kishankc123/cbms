-- Chart of Accounts: "Fixed expenses" and "Variable expenses" are merged and renamed to "Indirect expenses"
-- (a new "Direct expenses" category sits beside it). The underlying category stays "expense", so nothing in the
-- ledger or the reports changes — only the label an account carries.
UPDATE "accounts" SET "sub_category" = 'Indirect expenses' WHERE "sub_category" IN ('Fixed expenses', 'Variable expenses');
