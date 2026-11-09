-- The Review stage of a payroll run was removed (draft, approved, finalized): it changed only the label. A run still in review goes back to draft, which is
-- what it was: it had not been approved. The enum value itself stays, because Postgres cannot drop a value from an enum.
UPDATE "payroll_runs" SET "status" = 'draft' WHERE "status" = 'review';
