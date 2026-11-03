import { ArrowLeftRight, BookOpen, Boxes, Building2, ChartColumn, CreditCard, FileSearch, Landmark, LayoutGrid, ListTree, Mail, Receipt, Settings, ShieldCheck, ShoppingCart, Truck, Undo2, Users, Wallet, type LucideIcon } from "lucide-react";

// One icon for each top-level module, chosen to match its word. Navigation data names its icon with one of these keys,
// because a server component can hand a client component a string but not a component.
export const NAV_ICONS = {
  dashboard: LayoutGrid,
  chart: ListTree,
  customers: Users,
  sales: Receipt,
  returns: Undo2,
  purchases: ShoppingCart,
  suppliers: Truck,
  expenses: CreditCard,
  payments: ArrowLeftRight,
  inventory: Boxes,
  assets: Building2,
  payroll: Wallet,
  bank: Landmark,
  compliance: ShieldCheck,
  audit: FileSearch,
  journal: BookOpen,
  reports: ChartColumn,
  settings: Settings,
  organizations: Building2,
  mail: Mail,
} satisfies Record<string, LucideIcon>;

export type NavIconKey = keyof typeof NAV_ICONS;
