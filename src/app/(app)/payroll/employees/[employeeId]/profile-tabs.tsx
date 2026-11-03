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
  /** null when the person's role does not include seeing salary amounts: the pay tabs are then left out. */
  currentSalary: number | null;
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
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {TABS.filter((t) => props.currentSalary !== null || t.id === "profile" || t.id === "attendance").map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative inline-flex h-9 items-center whitespace-nowrap border-b-2 px-3 text-[13px] transition-colors ${tab === t.id ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" && <ProfilePanel employee={props.employee} currentSalary={props.currentSalary} salaryDates={props.salaryRecords.map((r) => r.effectiveFrom)} />}
      {tab === "salary" && props.currentSalary !== null && (
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
