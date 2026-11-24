-- A staff advance payment that was edited to another employee left its advance record (the Payroll > Advances list) on the old employee, while the books had moved.
-- Put every such record back with its payment's employee. An advance payroll has already recovered from is left as it is: it could not have been edited.
UPDATE staff_advances sa
SET employee_id = p.employee_id
FROM payments_ledger p
WHERE p.id = sa.payment_id
  AND p.employee_id IS NOT NULL
  AND sa.employee_id <> p.employee_id
  AND NOT EXISTS (SELECT 1 FROM staff_advance_recoveries r WHERE r.advance_id = sa.id);
