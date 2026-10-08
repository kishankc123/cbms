-- Excise returns apply only to companies that manufacture or import excisable goods, so they are not tracked for now. The
-- requirement stays in the configuration, switched off. What had been generated from it (and the checklist answer for it) is removed.
DELETE FROM "compliance_obligations" WHERE "template_id" IN (SELECT "id" FROM "compliance_requirement_templates" WHERE "key" = 'excise_return');
--> statement-breakpoint
DELETE FROM "compliance_catchup" WHERE "stream" = 'excise_return';
--> statement-breakpoint
UPDATE "compliance_requirement_templates" SET "is_active" = false WHERE "key" = 'excise_return';
