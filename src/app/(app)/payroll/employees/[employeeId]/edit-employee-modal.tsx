"use client";

import { useEffect, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { useRouter } from "next/navigation";
import { addSalaryChange, updateEmployee } from "../actions";
import { todayIso } from "@/lib/calendar";

import { DatePicker } from "@/components/calendar/date-picker";
const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "intern", label: "Intern" },
] as const;

const EMPLOYMENT_STATUSES = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "on_leave", label: "On leave" },
  { value: "terminated", label: "Terminated" },
] as const;

type Employee = {
  id: string;
  employeeCode: string;
  fullName: string;
  address: string | null;
  contactNumber: string | null;
  email: string | null;
  panNumber: string | null;
  joiningDate: string;
  leavingDate?: string | null;
  department: string | null;
  designation: string | null;
  employmentType: string;
  employmentStatus: string;
  bankName: string | null;
  bankAccountNumber: string | null;
};

/**
 * `currentSalary` is null for someone who may not see salaries, so the basic salary field is not shown. `salaryDates` are the dates a
 * salary is already recorded from: changing the amount on one of those dates corrects that salary instead of adding a new one.
 */
export function EditEmployeeModal({ employee, currentSalary, salaryDates, onClose }: { employee: Employee; currentSalary: number | null; salaryDates: string[]; onClose: () => void }) {
  const router = useRouter();
  const [employeeCode, setEmployeeCode] = useState(employee.employeeCode);
  const [fullName, setFullName] = useState(employee.fullName);
  const [address, setAddress] = useState(employee.address ?? "");
  const [contactNumber, setContactNumber] = useState(employee.contactNumber ?? "");
  const [email, setEmail] = useState(employee.email ?? "");
  const [panNumber, setPanNumber] = useState(employee.panNumber ?? "");
  const [joiningDate, setJoiningDate] = useState(employee.joiningDate);
  const [leavingDate, setLeavingDate] = useState(employee.leavingDate ?? "");
  const [department, setDepartment] = useState(employee.department ?? "");
  const [designation, setDesignation] = useState(employee.designation ?? "");
  const [employmentType, setEmploymentType] = useState(employee.employmentType as (typeof EMPLOYMENT_TYPES)[number]["value"]);
  const [employmentStatus, setEmploymentStatus] = useState(
    employee.employmentStatus as (typeof EMPLOYMENT_STATUSES)[number]["value"]
  );
  const [bankName, setBankName] = useState(employee.bankName ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(employee.bankAccountNumber ?? "");
  const [basicSalary, setBasicSalary] = useState(currentSalary === null ? "" : currentSalary.toFixed(2));
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [salaryReason, setSalaryReason] = useState("");
  const [saving, setSaving] = useState(false);
  const newSalary = parseFloat(basicSalary);
  const salaryChanged = currentSalary !== null && Number.isFinite(newSalary) && Math.abs(newSalary - currentSalary) >= 0.005;
  const replacing = salaryChanged && salaryDates.includes(effectiveFrom);
  // Problems are shown in a dialog that says why.
  const { report, dialog } = useProblem();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSave() {
    if (!employeeCode.trim() || !fullName.trim()) {
      report("Employee ID and full name are required.", null);
      return;
    }
    if (currentSalary !== null && !(newSalary > 0)) {
      report("Enter a basic salary greater than zero.", null);
      return;
    }
    if (salaryChanged && !effectiveFrom) {
      report("Choose the date the new salary starts from.", null);
      return;
    }
    if (salaryChanged && !salaryReason.trim()) {
      report("Say why the salary is changing, for example Increment or Correction.", null);
      return;
    }
    setSaving(true);
    try {
      await updateEmployee({
        employeeId: employee.id,
        employeeCode,
        fullName,
        address,
        contactNumber,
        email,
        panNumber,
        joiningDate,
        leavingDate,
        department,
        designation,
        employmentType,
        employmentStatus,
        bankName,
        bankAccountNumber,
      });
      if (salaryChanged) {
        await addSalaryChange({ employeeId: employee.id, changeType: "new_fixed", changeValue: 0, newFixedSalary: newSalary, effectiveFrom, reason: salaryReason, notes: "", replaceSameDate: replacing });
      }
      router.refresh();
      onClose();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-8">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-full max-w-2xl rounded-lg bg-white p-5 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Edit employee</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Employee ID</label>
            <input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Full Name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Address</label>
            <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Contact Number</label>
            <input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">PAN Number</label>
            <input value={panNumber} onChange={(e) => setPanNumber(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Joining Date</label>
            <DatePicker value={joiningDate} onChange={(v) => setJoiningDate(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Leaving Date (if left)</label>
            <DatePicker min={joiningDate} value={leavingDate} onChange={(v) => setLeavingDate(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Department</label>
            <input value={department} onChange={(e) => setDepartment(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Designation</label>
            <input value={designation} onChange={(e) => setDesignation(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Employment Type</label>
            <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as typeof employmentType)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
              {EMPLOYMENT_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Employment Status</label>
            <select value={employmentStatus} onChange={(e) => setEmploymentStatus(e.target.value as typeof employmentStatus)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
              {EMPLOYMENT_STATUSES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Bank Name</label>
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Bank Account Number</label>
            <input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          {currentSalary !== null && (
            <div className="col-span-2 space-y-3 rounded border border-gray-200 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Basic Salary</label>
                  <input type="number" min="0" step="0.01" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
                </div>
                {salaryChanged && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">New salary starts from</label>
                    <DatePicker value={effectiveFrom} onChange={(v) => setEffectiveFrom(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
                  </div>
                )}
              </div>
              {salaryChanged && (
                <>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Reason for the change</label>
                    <input value={salaryReason} onChange={(e) => setSalaryReason(e.target.value)} placeholder="For example Increment, or Correction of a typing mistake" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
                  </div>
                  <p className="text-xs text-gray-500">
                    {replacing
                      ? `This corrects the salary already recorded from ${effectiveFrom}. It is allowed until payroll has been finalized from that date, and the correction is kept in the audit log.`
                      : "Saved in Salary History from that date. Earlier months keep the salary they were paid at."}
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      {dialog}
    </div>
  );
}
