import { PrismaClient } from "@prisma/client";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
const globalDb = globalThis as unknown as { reboundDb?: PrismaClient };
export const db = globalDb.reboundDb ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.reboundDb = db;

export async function currentUser() {
  const jar = await cookies();
  let token = jar.get("rebound_identity")?.value;
  let user = token ? await db.user.findUnique({ where: { token } }) : null;
  if (!user) {
    token = randomBytes(32).toString("hex");
    user = await db.user.create({ data: { token } });
    const secure = process.env.COOKIE_SECURE !== "false";
    jar.set("rebound_identity", token, {
      httpOnly: true,
      secure,
      sameSite: secure ? "none" : "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return user;
}
