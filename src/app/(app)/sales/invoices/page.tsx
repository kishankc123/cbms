import { redirect } from "next/navigation";

// Invoices now live on the Sales page (Add new | Invoices).
export default function SalesInvoicesPage() {
  redirect("/sales?view=invoices");
}
