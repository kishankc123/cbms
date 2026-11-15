import { getLogo } from "@/lib/banking/institutions";

// A bank or wallet logo. Everything in the directory is the same for every organization; the address changes (?v=) when the logo does, so it can be cached for good.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = /^[0-9a-f-]{36}$/.test(id) ? await getLogo(id) : null;
  if (!found) return new Response(null, { status: 404 });
  return new Response(Buffer.from(found.logo, "base64"), {
    headers: {
      "Content-Type": found.logoType,
      "Cache-Control": "private, max-age=31536000, immutable",
      // A picture only: whatever an SVG carries, it cannot run anything.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
