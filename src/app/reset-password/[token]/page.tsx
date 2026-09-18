import { eq } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetTokens } from "@/db/schema";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.token, token))
    .limit(1);
  const isValid = !!row && !row.usedAt && row.expiresAt > new Date();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow p-8 space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Reset password</h1>
        {isValid ? (
          <ResetForm token={token} />
        ) : (
          <p className="text-sm text-red-600">This reset link is invalid or has expired.</p>
        )}
      </div>
    </div>
  );
}
