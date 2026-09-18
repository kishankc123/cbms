ALTER TABLE "purchase_bills" ALTER COLUMN "vendor_id" DROP NOT NULL;
--> statement-breakpoint
UPDATE "purchase_bills" SET "vendor_id" = NULL WHERE "vendor_id" IN (SELECT "id" FROM "vendors" WHERE "name" = 'Cash Purchase');