import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Idempotent demo/admin seed.
 *
 * Safety: in production the password must be supplied explicitly. The well-known
 * demo credentials are only allowed outside production so a deployed instance can
 * never be seeded with `demo1234` by accident.
 */
async function main() {
  const isProduction = process.env.NODE_ENV === "production";
  const email = (process.env.SEED_ADMIN_EMAIL ?? "demo@midea.local").toLowerCase();
  const configuredPassword = process.env.SEED_ADMIN_PASSWORD;

  if (isProduction && !configuredPassword) {
    throw new Error(
      "SEED_ADMIN_PASSWORD is required in production. Refusing to seed a known demo password."
    );
  }

  if (
    isProduction &&
    configuredPassword &&
    (configuredPassword.length < 12 || !/[A-Za-z]/.test(configuredPassword) || !/\d/.test(configuredPassword))
  ) {
    throw new Error(
      "SEED_ADMIN_PASSWORD must be at least 12 characters and include letters and digits."
    );
  }

  const password = configuredPassword ?? "demo1234";
  if (!isProduction) {
    console.warn(
      `[seed] Using ${configuredPassword ? "configured" : "demo"} password for ${email}. ` +
        "This is only allowed outside production."
    );
  }

  const cost = Number(process.env.BCRYPT_COST ?? 12);
  const passwordHash = await hash(password, Math.min(15, Math.max(10, cost)));

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      name: "Demo User",
      role: "admin"
    },
    create: {
      email,
      name: "Demo User",
      role: "admin",
      passwordHash,
      settings: {
        create: {
          country: "Mexico",
          language: "Spanish"
        }
      }
    }
  });

  console.log(`Seeded admin user ${user.email} (role=admin)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
