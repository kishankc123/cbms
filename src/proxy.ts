import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/signed-out"];
// Reachable while signed in but before an organization is chosen.
const NO_ORG_PATHS = ["/select-organization", "/create-organization", "/accept-invite", "/verify-email"];

const startsWithAny = (path: string, list: string[]) => list.some((p) => path.startsWith(p));

export default auth((req) => {
  const path = req.nextUrl.pathname;
  const isLoggedIn = Boolean(req.auth);
  const isPublicPage = startsWithAny(path, PUBLIC_PATHS) || path.startsWith("/accept-invite");

  if (!isLoggedIn && !isPublicPage) {
    const url = new URL("/login", req.url);
    if (path !== "/") url.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(url);
  }
  if (isLoggedIn && (path.startsWith("/login") || path.startsWith("/register"))) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  // Signed in but no active organization yet -> choose one first.
  if (isLoggedIn && !req.auth?.user?.activeTenantId && !startsWithAny(path, NO_ORG_PATHS) && !isPublicPage) {
    return NextResponse.redirect(new URL("/select-organization", req.url));
  }
});

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
