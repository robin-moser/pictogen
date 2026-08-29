import { useEffect, useState } from "preact/hooks";

import {
  createUser,
  deleteUser,
  listUsers,
  setUserAdministrator,
  setUserPassword,
  type UserAccount,
} from "../api.js";

type UserManagementProps = {
  minimumLength: number;
  currentUserId: string;
  onClose: () => void;
  onCurrentUserChanged: () => Promise<void>;
};

export function UserManagement({
  minimumLength,
  currentUserId,
  onClose,
  onCurrentUserChanged,
}: UserManagementProps) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshUsers() {
    setUsers(await listUsers());
  }

  useEffect(() => {
    refreshUsers().catch((loadError: unknown) => {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Users could not be loaded.",
      );
    });
  }, []);

  async function remove(user: UserAccount) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteUser(user.id);
      await refreshUsers();
      setConfirming(null);
      setNotice(`${user.username} was removed.`);
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "The account could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(event: SubmitEvent, user: UserAccount) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setUserPassword(user.id, resetPassword);
      await refreshUsers();
      setResetting(null);
      setResetPassword("");
      setNotice(`${user.username} must change their password at next sign-in.`);
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "The password could not be set.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateAdministrator(user: UserAccount) {
    const nextIsAdmin = !user.isAdmin;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await setUserAdministrator(user.id, nextIsAdmin);
      await refreshUsers();
      if (user.id === currentUserId) {
        await onCurrentUserChanged();
        if (!nextIsAdmin) onClose();
      }
      setNotice(
        nextIsAdmin
          ? `${user.username} is now an administrator.`
          : `${user.username} is no longer an administrator.`,
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Administrator access could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await createUser({ username, password, isAdmin });
      await refreshUsers();
      setUsername("");
      setPassword("");
      setIsAdmin(false);
      setNotice(`${username.trim()} was added.`);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "The user could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="users-title"
    >
      <div class="modal-box max-w-2xl">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h2 id="users-title" class="text-lg font-semibold">
              Users
            </h2>
            <p class="text-base-content/45 mt-1 text-sm">
              Manage local accounts and administrator access.
            </p>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div class="border-base-300 mt-5 overflow-hidden rounded-box border">
          {users.map((user) => (
            <div
              key={user.id}
              class="border-base-300 border-b px-4 py-3 last:border-b-0"
            >
              <div class="flex flex-wrap items-center gap-2">
                <div class="min-w-36 grow">
                  <p class="truncate text-sm font-medium">{user.displayName}</p>
                  <p class="text-base-content/45 truncate text-xs">
                    {user.username}
                  </p>
                </div>
                {user.isAdmin && (
                  <span class="badge badge-neutral badge-sm">Admin</span>
                )}
                {user.id !== currentUserId && (
                  <button
                    class="btn btn-ghost btn-xs"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setResetPassword("");
                      setConfirming(null);
                      setResetting(resetting === user.id ? null : user.id);
                    }}
                  >
                    {resetting === user.id ? "Cancel" : "Set password"}
                  </button>
                )}
                <button
                  class="btn btn-ghost btn-xs"
                  type="button"
                  disabled={busy}
                  onClick={() => void updateAdministrator(user)}
                >
                  {user.isAdmin ? "Remove admin" : "Make admin"}
                </button>
                {user.id !== currentUserId && (
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setResetting(null);
                      setConfirming(confirming === user.id ? null : user.id);
                    }}
                  >
                    {confirming === user.id ? "Keep" : "Remove"}
                  </button>
                )}
              </div>
              {confirming === user.id && (
                <div class="alert alert-warning mt-3 flex-wrap py-2 text-sm">
                  <span class="grow">
                    Removing {user.username} deletes their sessions and images.
                  </span>
                  <button
                    class="btn btn-error btn-sm"
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(user)}
                  >
                    Remove permanently
                  </button>
                </div>
              )}
              {resetting === user.id && (
                <form
                  class="mt-3 flex flex-wrap gap-2"
                  onSubmit={(event) => void submitReset(event, user)}
                >
                  <input
                    class="input input-sm min-w-0 grow"
                    aria-label={`New password for ${user.username}`}
                    placeholder={`New password (${minimumLength}+ characters)`}
                    type="password"
                    autocomplete="new-password"
                    minlength={minimumLength}
                    maxlength={256}
                    required
                    value={resetPassword}
                    onInput={(event) =>
                      setResetPassword(event.currentTarget.value)
                    }
                  />
                  <button
                    class="btn btn-primary btn-sm"
                    type="submit"
                    disabled={busy}
                  >
                    Save
                  </button>
                </form>
              )}
            </div>
          ))}
          {users.length === 0 && (
            <p class="text-base-content/45 px-4 py-5 text-sm">
              No users found.
            </p>
          )}
        </div>

        <form class="border-base-300 mt-6 border-t pt-5" onSubmit={submit}>
          <h3 class="field-legend mb-3">Add user</h3>
          <div class="grid gap-3 sm:grid-cols-2">
            <input
              class="input w-full"
              aria-label="Username"
              placeholder="Username"
              autocomplete="username"
              maxlength={80}
              required
              value={username}
              onInput={(event) => setUsername(event.currentTarget.value)}
            />
            <input
              class="input w-full"
              aria-label="Password"
              placeholder={`Password (${minimumLength}+ characters)`}
              type="password"
              autocomplete="new-password"
              minlength={minimumLength}
              maxlength={256}
              required
              value={password}
              onInput={(event) => setPassword(event.currentTarget.value)}
            />
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <label class="label cursor-pointer gap-2 py-0 text-sm">
              <input
                class="checkbox checkbox-sm"
                type="checkbox"
                checked={isAdmin}
                onChange={(event) => setIsAdmin(event.currentTarget.checked)}
              />
              Administrator
            </label>
            <button
              class="btn btn-primary btn-sm ml-auto"
              type="submit"
              disabled={busy}
            >
              {busy && <span class="loading loading-spinner loading-xs" />}
              Add user
            </button>
          </div>
        </form>

        {error && (
          <div class="alert alert-error mt-4 py-2 text-sm" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div class="alert alert-success mt-4 py-2 text-sm" role="status">
            {notice}
          </div>
        )}
      </div>
      <button
        class="modal-backdrop"
        type="button"
        aria-label="Close user management"
        onClick={onClose}
      />
    </div>
  );
}
