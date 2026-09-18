"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createEmployee } from "./actions";

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

const today = () => new Date().toISOString().slice(0, 10);

export function EmployeeAddForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [employeeCode, setEmployeeCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [email, setEmail] = useState("");
  const [panNumber, setPanNumber] = useState("");
  const [joiningDate, setJoiningDate] = useState(today());
  const [department, setDepartment] = useState("");
  const [designation, setDesignation] = useState("");
  const [employmentType, setEmploymentType] = useState<(typeof EMPLOYMENT_TYPES)[number]["value"]>("full_time");
  const [employmentStatus, setEmploymentStatus] = useState<(typeof EMPLOYMENT_STATUSES)[number]["value"]>("active");
  const [bankName, setBankName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [initialSalary, setInitialSalary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    if (!employeeCode.trim() || !fullName.trim()) {
      setError("Employee ID and full name are required.");
      return;
    }
    setSaving(true);
    try {
      await createEmployee({
        employeeCode,
        fullName,
        address,
        contactNumber,
        email,
        panNumber,
        joiningDate,
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
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4 rounded-lg border border-gray-200 bg-white p-5">
      <div className="grid grid-cols-2 gap-4">
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
          <input
            type="date"
            max={today()}
            value={joiningDate}
            onChange={(e) => setJoiningDate(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
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
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm px-4 py-1.5 disabled:opacity-50"
        >
          {saving ? "Saving..." : "+ Add employee"}
        </button>
      </div>
    </div>
  );
}
