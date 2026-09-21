ALTER TYPE "public"."payment_type" ADD VALUE 'salary_payment' BEFORE 'expense_payment';--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "leaving_date" date;--> statement-breakpoint
CREATE UNIQUE INDEX "employees_tenant_code" ON "employees" USING btree ("tenant_id","employee_code");