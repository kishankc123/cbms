import { VerifyForm } from "./verify-form";

// Verification happens on a button press (not on page load) so email security
// scanners that pre-open links can't consume the token.
export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-lg shadow p-8 space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">Verify your email</h1>
        <VerifyForm token={token} />
      </div>
    </div>
  );
}
