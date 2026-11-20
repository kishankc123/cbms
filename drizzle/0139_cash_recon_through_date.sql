ALTER TABLE "cash_reconciliations" ADD COLUMN "through_date" date;--> statement-breakpoint
-- What each reconciliation really reconciled up to: the date of the latest entry it took in (the adjustment it posted does not count). One that took in nothing keeps its cut-off date.
UPDATE "cash_reconciliations" r SET "through_date" = COALESCE((
  SELECT max(e."entry_date")
  FROM "cash_reconciliation_lines" l
  JOIN "journal_lines" jl ON jl."id" = l."journal_line_id"
  JOIN "journal_entries" e ON e."id" = jl."journal_entry_id"
  WHERE l."recon_id" = r."id" AND e."id" IS DISTINCT FROM r."adjustment_entry_id" AND e."source_type"::text <> 'opening_balance'
), r."as_of_date");--> statement-breakpoint
ALTER TABLE "cash_reconciliations" ALTER COLUMN "through_date" SET NOT NULL;
