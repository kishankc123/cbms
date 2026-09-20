import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { listActiveMemberships, hasActiveMembership } from "@/lib/memberships";
import { REMEMBER_MS } from "@/lib/session-expiry";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      // The organization this session is currently working in. null until the
      // user picks one (or when they belong to none).
      activeTenantId: string | null;
      sessionVersion: number;
      isPlatformAdmin: boolean;
      remember: boolean;
      loginAt: number;
      name: string;
      email: string;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    activeTenantId: string | null;
    sessionVersion: number;
    isPlatformAdmin: boolean;
    remember: boolean;
    loginAt: number;
  }
}

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
// Used to spend the same time on unknown emails as on real ones.
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8y0BqVxYvY8v8bKq0hQ8bXo0vJv7iG";

export const { handlers, signIn, signOut, auth, unstable_update } = NextAuth({
  session: { strategy: "jwt", maxAge: REMEMBER_MS / 1000 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        remember: { label: "Remember me", type: "text" },
      },
      authorize: async (credentials) => {
        const email = (credentials?.email as string | undefined)?.trim().toLowerCase();
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user) {
          await bcrypt.compare(password, DUMMY_HASH);
          return null;
        }
        if (user.status !== "active") return null;
        if (user.lockedUntil && user.lockedUntil > new Date()) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          const failed = user.failedLoginCount + 1;
          await db
            .update(users)
            .set(failed >= MAX_FAILED_LOGINS ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : { failedLoginCount: failed })
            .where(eq(users.id, user.id));
          return null;
        }

        await db.update(users).set({ lastLogin: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          sessionVersion: user.sessionVersion,
          isPlatformAdmin: user.isPlatformAdmin,
          remember: credentials?.remember === "true",
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        const u = user as { sessionVersion: number; isPlatformAdmin: boolean; remember: boolean };
        token.id = user.id as string;
        token.sessionVersion = u.sessionVersion;
        token.isPlatformAdmin = u.isPlatformAdmin;
        token.remember = u.remember;
        token.loginAt = Date.now();
        // One organization -> enter it straight away; several -> the user
        // chooses on /select-organization.
        const orgs = await listActiveMemberships(token.id);
        token.activeTenantId = orgs.length === 1 ? orgs[0].tenantId : null;
      }

      // Switching organization. The requested id comes from the client, so it
      // is never trusted: the membership is verified here before it is accepted.
      if (trigger === "update" && session && "activeTenantId" in session) {
        const requested = (session as { activeTenantId: string | null }).activeTenantId;
        if (requested === null) token.activeTenantId = null;
        else if (await hasActiveMembership(token.id, requested)) token.activeTenantId = requested;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.activeTenantId = token.activeTenantId ?? null;
      session.user.sessionVersion = token.sessionVersion;
      session.user.isPlatformAdmin = token.isPlatformAdmin;
      session.user.remember = token.remember;
      session.user.loginAt = token.loginAt;
      return session;
    },
  },
});
