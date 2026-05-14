import { LockKeyhole } from "lucide-react";
import { loginAction } from "@/app/admin/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="login-page">
      <section className="login-box">
        <LockKeyhole width={28} height={28} aria-hidden="true" />
        <h1>Bot 管理後台</h1>
        <p className="subtle">輸入管理密碼後即可查看 Notion 會員狀態與手動操作。</p>
        <form action={loginAction} className="stack">
          <div className="field">
            <label htmlFor="password">Admin Password</label>
            <input
              className="input"
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {params.error ? <p className="error">密碼不正確。</p> : null}
          <button className="button" type="submit">
            <LockKeyhole width={16} height={16} aria-hidden="true" />
            登入
          </button>
        </form>
      </section>
    </main>
  );
}
