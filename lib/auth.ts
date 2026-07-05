import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminPassword } from "@/lib/config";

const COOKIE_NAME = "tg_bot_admin";
const OPERATOR_COOKIE_NAME = "tg_bot_admin_operator";
const SESSION_VALUE = "admin";

export const knownOperators = ["小夏", "Rick"] as const;
export type Operator = (typeof knownOperators)[number];

export function isKnownOperator(value: string): value is Operator {
  return (knownOperators as readonly string[]).includes(value);
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createAdminSessionToken(password: string): string {
  return `${SESSION_VALUE}.${sign(SESSION_VALUE, password)}`;
}

export function verifyAdminSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const expected = createAdminSessionToken(getAdminPassword());
  return safeEqual(token, expected);
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyAdminSessionToken(cookieStore.get(COOKIE_NAME)?.value);
}

export async function requireAdmin() {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }
}

export async function assertAdminAction() {
  if (!(await isAdminAuthenticated())) {
    throw new Error("Unauthorized");
  }
}

export async function setAdminCookie(operator: string) {
  const cookieStore = await cookies();
  const maxAge = 60 * 60 * 12;
  cookieStore.set(COOKIE_NAME, createAdminSessionToken(getAdminPassword()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  cookieStore.set(
    OPERATOR_COOKIE_NAME,
    isKnownOperator(operator) ? operator : knownOperators[0],
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge,
    },
  );
}

export async function clearAdminCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(OPERATOR_COOKIE_NAME);
}

/** Who is currently operating the admin panel — used to attribute manual actions in Notion. */
export async function getAdminOperator(): Promise<Operator> {
  const cookieStore = await cookies();
  const value = cookieStore.get(OPERATOR_COOKIE_NAME)?.value;
  return value && isKnownOperator(value) ? value : knownOperators[0];
}
