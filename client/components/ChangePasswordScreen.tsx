import { useState } from "preact/hooks";

import { changePassword } from "../api.js";

type ChangePasswordScreenProps = {
  minimumLength: number;
  onChanged: () => Promise<void>;
  onCancel?: () => void;
};

export function ChangePasswordScreen({
  minimumLength,
  onChanged,
  onCancel,
}: ChangePasswordScreenProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("The new passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await changePassword({ currentPassword, newPassword });
      await onChanged();
    } catch (changeError) {
      setError(
        changeError instanceof Error
          ? changeError.message
          : "The password could not be changed.",
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
            <p class="text-base-content/45 text-xs">Choose a new password</p>
          </div>
        </header>

        <form class="space-y-4 p-6" onSubmit={submit}>
          <label class="form-control block">
            <span class="field-legend mb-2 block">Current password</span>
            <input
              class="input w-full"
              type="password"
              autocomplete="current-password"
              minlength={minimumLength}
              maxlength={256}
              required
              autofocus
              value={currentPassword}
              onInput={(event) => setCurrentPassword(event.currentTarget.value)}
            />
          </label>
          <label class="form-control block">
            <span class="field-legend mb-2 block">New password</span>
            <input
              class="input w-full"
              type="password"
              autocomplete="new-password"
              minlength={minimumLength}
              maxlength={256}
              required
              value={newPassword}
              onInput={(event) => setNewPassword(event.currentTarget.value)}
            />
            <span class="text-base-content/40 mt-2 text-xs">
              Use at least {minimumLength} characters.
            </span>
          </label>
          <label class="form-control block">
            <span class="field-legend mb-2 block">Confirm new password</span>
            <input
              class="input w-full"
              type="password"
              autocomplete="new-password"
              minlength={minimumLength}
              maxlength={256}
              required
              value={confirmation}
              onInput={(event) => setConfirmation(event.currentTarget.value)}
            />
          </label>
          {error && (
            <div class="alert alert-error py-2 text-sm" role="alert">
              {error}
            </div>
          )}
          <div class="flex gap-2">
            {onCancel && (
              <button
                class="btn btn-ghost flex-1"
                type="button"
                onClick={onCancel}
              >
                Cancel
              </button>
            )}
            <button
              class="btn btn-primary flex-1"
              type="submit"
              disabled={busy}
            >
              {busy && <span class="loading loading-spinner loading-xs" />}
              Save password
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
