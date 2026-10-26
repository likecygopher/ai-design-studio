import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: string;
      /** Session token version; must equal `User.authVersion` on every check. */
      authVersion?: number;
      /** Server-side session row (device) backing this JWT. */
      sessionId?: string;
    };
  }

  interface User {
    role?: string;
    authVersion?: number;
    sessionId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    authVersion?: number;
    sessionId?: string;
  }
}
