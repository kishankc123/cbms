ALTER TABLE "compliance_obligations" ADD COLUMN "frequency" "requirement_frequency";--> statement-breakpoint
UPDATE "compliance_obligations" o SET "frequency" = t."frequency" FROM "compliance_requirement_templates" t WHERE o."template_id" = t."id";
