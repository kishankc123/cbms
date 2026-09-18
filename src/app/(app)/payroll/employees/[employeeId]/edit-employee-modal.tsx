"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateEmployee } from "../actions";

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
  department: string | null;
  designation: string | null;
  employmentType: string;
  employmentStatus: string;
  bankName: string | null;
  bankAccountNumber: string | null;
};

export function EditEmployeeModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const router = useRouter();
  const [employeeCode, setEmployeeCode] = useState(employee.employeeCode);
  const [fullName, setFullName] = useState(employee.fullName);
  const [address, setAddress] = useState(employee.address ?? "");
  const [contactNumber, setContactNumber] = useState(employee.contactNumber ?? "");
  const [email, setEmail] = useState(employee.email ?? "");
  const [panNumber, setPanNumber] = useState(employee.panNumber ?? "");
  const [joiningDate, setJoiningDate] = useState(employee.joiningDate);
  const [department, setDepartment] = useState(employee.department ?? "");
  const [designation, setDesignation] = useState(employee.designation ?? "");
  const [employmentType, setEmploymentType] = useState(employee.employmentType as (typeof EMPLOYMENT_TYPES)[number]["value"]);
  const [employmentStatus, setEmploymentStatus] = useState(
    employee.employmentStatus as (typeof EMPLOYMENT_STATUSES)[number]["value"]
  );
  const [bankName, setBankName] = useState(employee.bankName ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(employee.bankAccountNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSave() {
    setError(null);
    if (!employeeCode.trim() || !fullName.trim()) {
      setError("Employee ID and full name are required.");
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
        department,
        designation,
        employmentType,
        employmentStatus,
        bankName,
        bankAccountNumber,
      });
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
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
            <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
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
        </div>

        <div className="flex justify-end gap-2 pt-2">
          {error && <span className="mr-auto self-center text-xs text-red-600">{error}</span>}
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
    </div>
  );
}
