import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/**
 * Unit tests render client components directly (no Next.js server runtime),
 * so `next-auth/react` needs a deterministic session stub instead of a real
 * SessionProvider. Server-side auth is mocked per-test where it matters.
 */
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "test-user", email: "test@midea.local", name: "Test User" },
      expires: "2099-01-01T00:00:00.000Z"
    },
    status: "authenticated",
    update: vi.fn()
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: unknown }) => children
}));
