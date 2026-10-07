CREATE TABLE "payment_mode_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mode_id" uuid NOT NULL,
	"account_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_modes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_mode_accounts" ADD CONSTRAINT "payment_mode_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_mode_accounts" ADD CONSTRAINT "payment_mode_accounts_mode_id_payment_modes_id_fk" FOREIGN KEY ("mode_id") REFERENCES "public"."payment_modes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_mode_accounts" ADD CONSTRAINT "payment_mode_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_modes" ADD CONSTRAINT "payment_modes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_mode_accounts_account" ON "payment_mode_accounts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "payment_mode_accounts_mode" ON "payment_mode_accounts" USING btree ("mode_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_modes_tenant_name" ON "payment_modes" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
-- Every existing organization starts with the standard modes; Cash takes the Cash account, Bank transfer takes the bank accounts.
INSERT INTO "payment_modes" ("tenant_id", "name", "sort_order")
SELECT t."id", v."name", v."ord" FROM "tenants" t CROSS JOIN (VALUES ('Cash', 1), ('Cheque', 2), ('Bank transfer', 3), ('Fonepay', 4), ('Card', 5), ('Wallet', 6)) AS v("name", "ord");
--> statement-breakpoint
INSERT INTO "payment_mode_accounts" ("tenant_id", "mode_id", "account_id")
SELECT a."tenant_id", m."id", a."id"
FROM "accounts" a
JOIN "payment_modes" m ON m."tenant_id" = a."tenant_id" AND m."name" = CASE WHEN a."code" = '1000' THEN 'Cash' ELSE 'Bank transfer' END
WHERE a."is_active" AND a."category" = 'asset'
  AND (a."code" = '1000' OR a."code" = '1010' OR a."code" LIKE '1010.%')
  AND NOT EXISTS (SELECT 1 FROM "accounts" c WHERE c."parent_account_id" = a."id" AND c."is_active");
