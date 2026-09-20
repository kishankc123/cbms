ALTER TYPE "public"."journal_source_type" ADD VALUE 'sales_return';--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"note_number" text NOT NULL,
	"note_date" date NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gross_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(18, 2) NOT NULL,
	"tax_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_returns_tenant_number" ON "sales_returns" USING btree ("tenant_id","note_number");