"use client";

import { useEffect, useState } from "react";
import { useProblem } from "@/components/problem-dialog";
import { useRouter } from "next/navigation";
import { createEmployee, getNextEmployeeCode } from "./actions";

import { DatePicker } from "@/components/calendar/date-picker";
import { todayIso } from "@/lib/calendar";
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

const today = () => todayIso();

export function EmployeeAddForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  // The ID is generated; this is only what the next one will be.
  const [nextCode, setNextCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [email, setEmail] = useState("");
  const [panNumber, setPanNumber] = useState("");
  const [joiningDate, setJoiningDate] = useState(today());
  const [leavingDate, setLeavingDate] = useState("");
  const [department, setDepartment] = useState("");
  const [designation, setDesignation] = useState("");
  const [employmentType, setEmploymentType] = useState<(typeof EMPLOYMENT_TYPES)[number]["value"]>("full_time");
  const [employmentStatus, setEmploymentStatus] = useState<(typeof EMPLOYMENT_STATUSES)[number]["value"]>("active");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [initialSalary, setInitialSalary] = useState("");
  const [saving, setSaving] = useState(false);
  // Problems are shown in a dialog that says why.
  const { report, dialog } = useProblem();

  useEffect(() => {
    let live = true;
    getNextEmployeeCode()
      .then((c) => live && setNextCode(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function handleSave() {
    if (!fullName.trim()) {
      report("Full name is required.", null);
      return;
    }
    setSaving(true);
    try {
      await createEmployee({
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
        initialSalary: parseFloat(initialSalary) || 0,
      });
      router.refresh();
      onDone();
    } catch (e) {
      report(e instanceof Error ? e.message : "Failed to save", null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Employee ID</label>
          <input value={nextCode || "Assigned when saved"} readOnly disabled className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-500" />
          <p className="mt-0.5 text-[11px] text-gray-400">Generated automatically.</p>
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
          <DatePicker max={today()} value={joiningDate} onChange={(v) => setJoiningDate(v)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
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
          <select
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value as typeof employmentType)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {EMPLOYMENT_TYPES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Employment Status</label>
          <select
            value={employmentStatus}
            onChange={(e) => setEmploymentStatus(e.target.value as typeof employmentStatus)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
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
        <div>
          <label className="block text-xs text-gray-500 mb-1">Initial Basic Salary</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={initialSalary}
            onChange={(e) => setInitialSalary(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">Creates the first Salary History record, effective from the joining date.</p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
        >
          {saving ? "Saving..." : "+ Add employee"}
        </button>
      </div>
      {dialog}
    </div>
  );
}
