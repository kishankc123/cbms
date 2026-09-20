import { and, eq, isNull, gt } from "drizzle-orm";
import { db } from "@/db";
import { authTokens } from "@/db/schema";
import { hashToken } from "@/lib/tokens";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const [row] = await db
    .select({ id: authTokens.id })
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.type, "password_reset"), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow p-8 space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Reset password</h1>
        {row ? <ResetForm token={token} /> : <p className="text-sm text-red-600">This reset link is invalid or has expired.</p>}
      </div>
    </div>
  );
}
