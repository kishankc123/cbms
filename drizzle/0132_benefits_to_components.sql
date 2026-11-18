-- Benefits are retired: what they did, salary components do better (named lines on the payslip, taxable or not, counted for SSF/PF or not).
-- Every active benefit of an employee becomes an ordinary salary component assigned to them with the same amount and dates, so nobody's pay changes.
-- A yearly benefit becomes a monthly amount of one twelfth. Payroll runs already made keep their figures. The old records stay in the table, marked inactive.
DO $$
DECLARE
  r record;
  comp_id uuid;
  comp_name text;
BEGIN
  FOR r IN
    SELECT DISTINCT tenant_id, benefit_type, CASE WHEN frequency = 'one_time' THEN 'one_time' ELSE 'recurring' END AS recurrence
    FROM employee_benefits
    WHERE employee_id IS NOT NULL AND eligibility_status = 'active'
  LOOP
    comp_name := r.benefit_type || CASE WHEN r.recurrence = 'one_time' THEN ' (one-time)' ELSE '' END;
    IF EXISTS (SELECT 1 FROM payroll_components WHERE tenant_id = r.tenant_id AND name = comp_name) THEN
      comp_name := comp_name || ' (benefit)';
    END IF;

    INSERT INTO payroll_components (tenant_id, name, type, amount, taxable, calc_type, counts_for_retirement, recurrence, auto_assign)
    VALUES (r.tenant_id, comp_name, 'allowance', 0, true, 'fixed', false, r.recurrence, false)
    RETURNING id INTO comp_id;

    INSERT INTO employee_components (tenant_id, employee_id, component_id, amount, effective_from, effective_to, notes)
    SELECT b.tenant_id, b.employee_id, comp_id,
           CASE WHEN b.frequency = 'yearly' THEN round(b.amount / 12, 2) ELSE b.amount END,
           b.effective_from, b.effective_to, 'Moved from Benefits'
    FROM employee_benefits b
    WHERE b.tenant_id = r.tenant_id
      AND b.benefit_type = r.benefit_type
      AND b.employee_id IS NOT NULL
      AND b.eligibility_status = 'active'
      AND (CASE WHEN b.frequency = 'one_time' THEN 'one_time' ELSE 'recurring' END) = r.recurrence;
  END LOOP;

  UPDATE employee_benefits
  SET eligibility_status = 'inactive', effective_to = COALESCE(effective_to, CURRENT_DATE)
  WHERE eligibility_status = 'active';
END $$;
