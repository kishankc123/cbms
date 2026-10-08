// Pure rules about payment modes, usable on both the server and the screens.

export type PaymentMethod = "cash" | "bank_transfer" | "cheque" | "card" | "online" | "other";

/** The payment method on the payment record that goes with a mode, going by its name (Cash, Cheque, Fonepay, ...). */
export function methodForMode(name: string): PaymentMethod {
  const n = name.toLowerCase();
  if (n.includes("cheque") || n.includes("check")) return "cheque";
  if (n.includes("cash")) return "cash";
  if (n.includes("card")) return "card";
  if (n.includes("fonepay") || n.includes("wallet") || n.includes("esewa") || n.includes("khalti") || n.includes("online") || n.includes("qr")) return "online";
  if (n.includes("bank") || n.includes("transfer")) return "bank_transfer";
  return "other";
}
