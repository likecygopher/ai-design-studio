import type { NextAuthConfig } from "next-auth";
import { PLATFORM_CONFIG } from "@/src/platform/config";

export const authConfig = {
  session: {
    strategy: "jwt",
    maxAge: PLATFORM_CONFIG.authSessionMaxAgeSec,
    updateAge: PLATFORM_CONFIG.authSessionUpdateAgeSec
  },
  pages: {
    signIn: "/login"
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (
        pathname.startsWith("/api/auth") ||
        pathname === "/" ||
        pathname === "/login" ||
        pathname === "/register"
      ) {
        return true;
      }
      return Boolean(auth?.user);
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = (user as { role?: string }).role ?? "user";
        token.authVersion = (user as { authVersion?: number }).authVersion ?? 0;
        token.sessionId = (user as { sessionId?: string }).sessionId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = typeof token.role === "string" ? token.role : "user";
        session.user.authVersion =
          typeof token.authVersion === "number" ? token.authVersion : 0;
        session.user.sessionId = typeof token.sessionId === "string" ? token.sessionId : undefined;
      }
      return session;
    }
  },
  trustHost: true
} satisfies NextAuthConfig;
