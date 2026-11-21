-- Before this change, editing a recurring expense's start date left the date its schedule is built from (effective_from) where it was, so a start moved back never booked the earlier months.
-- Bring those in line: a recurring expense whose start date is earlier than its effective date, and which was never resumed from a pause (a resume is what sets effective_from on purpose), is built from its start date.
UPDATE "recurring_expenses" r SET "effective_from" = r."start_date"
WHERE r."effective_from" > r."start_date"
  AND NOT EXISTS (SELECT 1 FROM "audit_log" a WHERE a."action" = 'recurring_expense_resumed' AND a."entity_type" = 'recurring_expense' AND a."entity_id" = r."id"::text);
