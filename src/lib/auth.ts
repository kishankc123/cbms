import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { Permissions } from "@/db/schema/tenancy";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      tenantId: string | null;
      role: "super_admin" | "admin" | "user";
      permissions: Permissions;
      name: string;
      email: string;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    tenantId: string | null;
    role: "super_admin" | "admin" | "user";
    permissions: Permissions;
  }
}

// Identifies which tenant a login belongs to. Until the super admin UI for
// issuing per-tenant client codes exists, this single test code is accepted.
const TEST_CLIENT_CODE = "101";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        clientCode: { label: "Client Code", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const clientCode = credentials?.clientCode as string | undefined;
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!clientCode || !email || !password) return null;
        if (clientCode !== TEST_CLIENT_CODE) return null;

        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (!user || user.status !== "active") return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));

        return {
          id: user.id,
          tenantId: user.tenantId,
          role: user.role,
          permissions: user.permissions,
          name: user.name,
          email: user.email,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.tenantId = (user as { tenantId: string | null }).tenantId;
        token.role = (user as { role: "super_admin" | "admin" | "user" }).role;
        token.permissions = (user as { permissions: Permissions }).permissions;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.tenantId = token.tenantId;
      session.user.role = token.role;
      session.user.permissions = token.permissions;
      return session;
    },
  },
});
