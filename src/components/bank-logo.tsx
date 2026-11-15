import { colourOf, initials, logoUrl, type Institution } from "@/lib/banking/institution-rules";

/** A bank or wallet's logo, or a coloured circle with its initials when it has none. */
export function BankLogo({ name, institution, size = 28 }: { name: string; institution?: Pick<Institution, "id" | "updatedAt" | "hasLogo"> | null; size?: number }) {
  const box = { width: size, height: size };
  return institution?.hasLogo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl(institution)} alt="" style={box} className="shrink-0 rounded-full border border-line bg-white object-contain" />
  ) : (
    <span aria-hidden style={{ ...box, background: colourOf(name), fontSize: size * 0.4 }} className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white">
      {initials(name)}
    </span>
  );
}
