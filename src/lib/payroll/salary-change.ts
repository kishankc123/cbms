import type { salaryChangeTypeEnum } from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

type ChangeType = (typeof salaryChangeTypeEnum.enumValues)[number];

// Pure calculation shared between the server action (actual save) and the
// client form (live preview of the new salary before saving).
export function computeNewSalary(previousSalary: number, changeType: ChangeType, changeValue: number, newFixedSalary: number) {
  switch (changeType) {
    case "percentage_increase":
      return round2(previousSalary + previousSalary * (changeValue / 100));
    case "percentage_decrease":
      return round2(previousSalary - previousSalary * (changeValue / 100));
    case "fixed_increase":
      return round2(previousSalary + changeValue);
    case "fixed_decrease":
      return round2(previousSalary - changeValue);
    case "new_fixed":
      return round2(newFixedSalary);
    case "initial":
      return round2(newFixedSalary);
  }
}
