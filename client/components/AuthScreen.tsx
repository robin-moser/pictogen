import { useState } from "preact/hooks";

import { authenticateLocal } from "../api.js";

type AuthScreenProps = {
  minimumLength: number;
  onAuthenticated: () => Promise<void>;
};

export function AuthScreen({
  minimumLength,
  onAuthenticated,
}: AuthScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authenticateLocal({ username, password });
      await onAuthenticated();
    } catch (authenticationError) {
      setError(
        authenticationError instanceof Error
          ? authenticationError.message
          : "Authentication failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="empty-workspace relative flex min-h-dvh items-center justify-center overflow-hidden p-5">
      <section class="bg-base-200 border-base-300 relative z-10 w-full max-w-sm rounded-box border shadow-2xl shadow-black/10">
        <header class="border-base-300 flex items-center gap-3 border-b px-6 py-5">
          <img src="/logo.svg" alt="" width="36" height="36" />
          <div>
            <h1 class="font-semibold tracking-[-0.025em]">Pictogen</h1>
            <p class="text-base-content/45 text-xs">Authentication required</p>
          </div>
        </header>

        <form class="space-y-4 p-6" onSubmit={submit}>
          <h2 class="text-lg font-semibold tracking-tight">Sign in</h2>
          <label class="form-control block">
            <span class="field-legend mb-2 block">Username</span>
            <input
              class="input w-full"
              name="username"
              autocomplete="username"
              maxlength={80}
              required
              autofocus
              value={username}
              onInput={(event) => setUsername(event.currentTarget.value)}
            />
          </label>
          <label class="form-control block">
            <span class="field-legend mb-2 block">Password</span>
            <input
              class="input w-full"
              name="password"
              type="password"
              autocomplete="current-password"
              minlength={minimumLength}
              maxlength={256}
              required
              value={password}
              onInput={(event) => setPassword(event.currentTarget.value)}
            />
          </label>
          {error && (
            <div class="alert alert-error py-2 text-sm" role="alert">
              {error}
            </div>
          )}
          <button class="btn btn-primary w-full" type="submit" disabled={busy}>
            {busy && <span class="loading loading-spinner loading-xs" />}
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
