"use client";

import { useState } from "react";
import { EditEmployeeModal } from "./edit-employee-modal";

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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm text-gray-900">{value || "—"}</p>
    </div>
  );
}

export function ProfilePanel({ employee, currentSalary }: { employee: Employee; currentSalary: number }) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setEditing(true)} className="text-sm text-gray-600 hover:underline">
          Edit
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 rounded-lg border border-gray-200 bg-white p-5">
        <Field label="Employee ID" value={employee.employeeCode} />
        <Field label="Full Name" value={employee.fullName} />
        <Field label="Address" value={employee.address ?? ""} />
        <Field label="Contact Number" value={employee.contactNumber ?? ""} />
        <Field label="Email" value={employee.email ?? ""} />
        <Field label="PAN Number" value={employee.panNumber ?? ""} />
        <Field label="Joining Date" value={employee.joiningDate} />
        <Field label="Department" value={employee.department ?? ""} />
        <Field label="Designation" value={employee.designation ?? ""} />
        <Field label="Employment Type" value={employee.employmentType.replace("_", " ")} />
        <Field label="Employment Status" value={employee.employmentStatus.replace("_", " ")} />
        <Field label="Bank Name" value={employee.bankName ?? ""} />
        <Field label="Bank Account Number" value={employee.bankAccountNumber ?? ""} />
        <Field label="Current Basic Salary" value={currentSalary.toFixed(2)} />
      </div>

      {editing && <EditEmployeeModal employee={employee} onClose={() => setEditing(false)} />}
    </div>
  );
}
