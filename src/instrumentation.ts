// Runs once when the server starts (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installServerErrorMessages } = await import("./lib/user-facing-errors");
    installServerErrorMessages();
  }
}
