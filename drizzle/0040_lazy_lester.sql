CREATE UNIQUE INDEX "accounts_tenant_code" ON "accounts" USING btree ("tenant_id","code");--> statement-breakpoint
-- Normalise legacy / missing sub-category labels to the current fixed set (top-level accounts first).
UPDATE "accounts" SET "sub_category" = 'Current assets' WHERE "parent_account_id" IS NULL AND "category" = 'asset' AND ("sub_category" IS NULL OR "sub_category" = 'Current Asset');--> statement-breakpoint
UPDATE "accounts" SET "sub_category" = 'Fixed assets' WHERE "parent_account_id" IS NULL AND "category" = 'asset' AND "sub_category" = 'Non-Current Asset';--> statement-breakpoint
UPDATE "accounts" SET "sub_category" = 'Current liabilities' WHERE "parent_account_id" IS NULL AND "category" = 'liability' AND ("sub_category" IS NULL OR "sub_category" = 'Current Liability');--> statement-breakpoint
UPDATE "accounts" SET "sub_category" = 'Non current liabilities' WHERE "parent_account_id" IS NULL AND "category" = 'liability' AND "sub_category" = 'Non-Current Liability';--> statement-breakpoint
UPDATE "accounts" SET "sub_category" = 'Equity & reserve' WHERE "parent_account_id" IS NULL AND "category" = 'equity' AND "sub_category" IS NULL;--> statement-breakpoint
UPDATE "accounts" SET "sub_category" = 'Revenue' WHERE "parent_account_id" IS NULL AND "category" = 'income' AND "sub_category" IS NULL;--> statement-breakpoint
UPDATE "accounts" SET "sub_category" = 'Cost of goods sold' WHERE "parent_account_id" IS NULL AND "category" = 'expense' AND "sub_category" IS NULL AND "code" = '5000';--> statement-breakpoint
UPDATE "accounts" SET "sub_category" = 'Fixed expenses' WHERE "parent_account_id" IS NULL AND "category" = 'expense' AND "sub_category" IS NULL AND "code" IN ('5100', '5300');--> statement-breakpoint
UPDATE "accounts" SET "sub_category" = 'Variable expenses' WHERE "parent_account_id" IS NULL AND "category" = 'expense' AND "sub_category" IS NULL;--> statement-breakpoint
-- Sub-accounts take their group's sub-category (two passes cover nesting).
UPDATE "accounts" c SET "sub_category" = p."sub_category" FROM "accounts" p WHERE c."parent_account_id" = p."id" AND p."sub_category" IS NOT NULL AND c."sub_category" IS DISTINCT FROM p."sub_category";--> statement-breakpoint
UPDATE "accounts" c SET "sub_category" = p."sub_category" FROM "accounts" p WHERE c."parent_account_id" = p."id" AND p."sub_category" IS NOT NULL AND c."sub_category" IS DISTINCT FROM p."sub_category";
