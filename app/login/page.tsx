import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6">
      <h1 className="font-display text-[34px] font-semibold tracking-tight">LifeOS</h1>
      <p className="mt-1 text-ink-2">Sign in to continue.</p>
      <form action={login} className="mt-8 flex flex-col gap-3">
        <label className="section-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="h-11 rounded-card border border-line bg-paper-2 px-3 text-ink outline-none focus:border-accent"
        />
        <label className="section-label mt-2" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="h-11 rounded-card border border-line bg-paper-2 px-3 text-ink outline-none focus:border-accent"
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button
          type="submit"
          className="mt-4 h-11 rounded-card bg-accent font-medium text-white active:opacity-90"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
