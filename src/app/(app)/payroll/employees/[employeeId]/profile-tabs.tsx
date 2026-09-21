"use client";

import { useState } from "react";
import { ProfilePanel } from "./profile-panel";
import { SalaryHistoryPanel } from "./salary-history-panel";
import { BenefitsPanel } from "./benefits-panel";
import { AttendancePanel } from "./attendance-panel";
import { PayslipsPanel } from "./payslips-panel";
import { AdvancesPanel } from "./advances-panel";
import type { AttendanceStatus } from "../attendance-actions";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "salary", label: "Salary History" },
  { id: "benefits", label: "Benefits" },
  { id: "attendance", label: "Attendance" },
  { id: "payslips", label: "Payslips" },
  { id: "advances", label: "Advances" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ProfileTabs(props: {
  employee: Parameters<typeof ProfilePanel>[0]["employee"];
  currentSalary: number;
  salaryRecords: Parameters<typeof SalaryHistoryPanel>[0]["records"];
  benefits: Parameters<typeof BenefitsPanel>[0]["benefits"];
  attendanceMonth: number;
  attendanceYear: number;
  attendanceRecords: Record<string, AttendanceStatus>;
  payslips: Parameters<typeof PayslipsPanel>[0]["payslips"];
  advances: Parameters<typeof AdvancesPanel>[0]["advances"];
}) {
  const [tab, setTab] = useState<TabId>("profile");

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-full bg-gray-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
              tab === t.id ? "bg-white text-gray-900 font-medium shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && <ProfilePanel employee={props.employee} currentSalary={props.currentSalary} />}
      {tab === "salary" && (
        <SalaryHistoryPanel employeeId={props.employee.id} currentSalary={props.currentSalary} records={props.salaryRecords} />
      )}
      {tab === "benefits" && <BenefitsPanel employeeId={props.employee.id} benefits={props.benefits} />}
      {tab === "attendance" && (
        <AttendancePanel
          employeeId={props.employee.id}
          month={props.attendanceMonth}
          year={props.attendanceYear}
          records={props.attendanceRecords}
        />
      )}
      {tab === "payslips" && <PayslipsPanel payslips={props.payslips} />}
      {tab === "advances" && <AdvancesPanel advances={props.advances} />}
    </div>
  );
}
