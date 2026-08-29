import { useState } from "preact/hooks";

import type { SessionSummary } from "../../shared/contracts.js";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  KeyIcon,
  LogoutIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  SunIcon,
  TrashIcon,
  UsersIcon,
} from "./Icons.js";

type Theme = "pictogen-dark" | "pictogen-light";
type ConnectionState = "checking" | "connected" | "unavailable";

const connectionStates: Record<
  ConnectionState,
  { label: string; dot: string }
> = {
  checking: { label: "Connecting", dot: "status-neutral" },
  connected: { label: "Connected", dot: "status-success" },
  unavailable: { label: "Unavailable", dot: "status-error" },
};

type SessionSidebarProps = {
  collapsed: boolean;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  user: string;
  connection: ConnectionState;
  busySessionId: string | null;
  theme: Theme;
  onToggleTheme: () => void;
  canManageUsers: boolean;
  canLogout: boolean;
  canChangePassword: boolean;
  onManageUsers: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  onCreate: (title: string) => Promise<boolean>;
  onOpen: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<boolean>;
  onDelete: (session: SessionSummary) => void;
  onCollapse: () => void;
  onExpand: () => void;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function formatCost(microusd: number) {
  return `$${(microusd / 1_000_000).toFixed(2)}`;
}

export function SessionSidebar({
  collapsed,
  sessions,
  activeSessionId,
  user,
  connection,
  busySessionId,
  theme,
  onToggleTheme,
  canManageUsers,
  canLogout,
  canChangePassword,
  onManageUsers,
  onChangePassword,
  onLogout,
  onCreate,
  onOpen,
  onRename,
  onDelete,
  onCollapse,
  onExpand,
}: SessionSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  async function submitCreate(event: SubmitEvent) {
    event.preventDefault();

    if (await onCreate(createTitle.trim() || "Untitled session")) {
      setCreateTitle("");
      setCreating(false);
    }
  }

  async function submitRename(event: SubmitEvent, sessionId: string) {
    event.preventDefault();
    const title = editTitle.trim();

    if (title && (await onRename(sessionId, title))) {
      setEditingId(null);
    }
  }

  return (
    <aside
      class={`border-base-300 bg-base-200 flex min-h-full w-76 flex-col border-r transition-[width] duration-200 ${collapsed ? "lg:w-16" : "lg:w-76"}`}
    >
      <div
        class={`hidden min-h-0 grow flex-col items-center py-5 ${collapsed ? "lg:flex" : ""}`}
      >
        <a class="flex size-9 items-center justify-center" href="/">
          <img src="/logo.svg" alt="Pictogen" width="36" height="36" />
        </a>
        <div class="border-base-300 my-4 w-8 border-t" />
        <button
          class="btn btn-ghost btn-sm btn-square"
          type="button"
          aria-label="Expand sessions"
          title="Expand sessions"
          onClick={onExpand}
        >
          <ChevronRightIcon class="size-4" />
        </button>
        <div class="grow" />
        <span
          class={`status status-sm mb-3 ${connectionStates[connection].dot}`}
          title={connectionStates[connection].label}
          aria-label={connectionStates[connection].label}
        />
        <button
          class="btn btn-ghost btn-sm btn-square"
          type="button"
          aria-label={
            theme === "pictogen-dark"
              ? "Switch to light theme"
              : "Switch to dark theme"
          }
          title="Toggle theme"
          onClick={onToggleTheme}
        >
          {theme === "pictogen-dark" ? (
            <SunIcon class="size-4" />
          ) : (
            <MoonIcon class="size-4" />
          )}
        </button>
        {canLogout && (
          <button
            class="btn btn-ghost btn-sm btn-square mt-1"
            type="button"
            aria-label="Sign out"
            title="Sign out"
            onClick={onLogout}
          >
            <LogoutIcon class="size-4" />
          </button>
        )}
      </div>

      <div
        class={`min-h-0 grow flex-col ${collapsed ? "flex lg:hidden" : "flex"}`}
      >
        <div class="flex items-center gap-3 px-5 pt-5 pb-5">
          <a class="flex min-w-0 items-center gap-2.5" href="/">
            <img
              class="size-9 shrink-0"
              src="/logo.svg"
              alt=""
              width="38"
              height="38"
            />
            <span class="text-lg font-semibold tracking-[-0.025em]">
              Pictogen
            </span>
          </a>
          <button
            class="btn btn-ghost btn-sm btn-square ml-auto shrink-0"
            type="button"
            aria-label="New session"
            aria-expanded={creating}
            title="New session"
            onClick={() => setCreating((value) => !value)}
          >
            {creating ? (
              <CloseIcon class="size-4" />
            ) : (
              <PlusIcon class="size-4" />
            )}
          </button>
          <button
            class="btn btn-ghost btn-sm btn-square hidden shrink-0 lg:inline-flex"
            type="button"
            aria-label="Collapse sessions"
            title="Collapse sessions"
            onClick={onCollapse}
          >
            <ChevronLeftIcon class="size-4" />
          </button>
        </div>

        {creating && (
          <form class="px-4 pb-5" onSubmit={submitCreate}>
            <div class="join w-full">
              <input
                id="new-session-title"
                class="input input-sm join-item min-w-0 grow"
                value={createTitle}
                maxLength={120}
                placeholder="Session name"
                aria-label="New session name"
                autofocus
                onInput={(event) => setCreateTitle(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setCreating(false);
                }}
              />
              <button
                class="btn btn-sm btn-primary join-item shrink-0"
                type="submit"
              >
                Create
              </button>
            </div>
          </form>
        )}

        <div class="flex items-center justify-between px-5 pt-1 pb-3">
          <h2 class="field-legend">Sessions</h2>
          <span class="text-base-content/40 text-xs tabular-nums">
            {sessions.length}
          </span>
        </div>

        <nav class="scroll-pane grow px-3 pb-5" aria-label="Saved sessions">
          {sessions.length === 0 ? (
            <p class="text-base-content/40 px-2 py-6 text-center text-xs">
              No sessions yet.
            </p>
          ) : (
            <ul class="flex flex-col gap-1.5">
              {sessions.map((session) => {
                const active = session.id === activeSessionId;
                const editing = session.id === editingId;
                const busy = session.id === busySessionId;

                if (editing) {
                  return (
                    <li key={session.id}>
                      <form
                        class="bg-base-100 border-base-300 rounded-field border p-1.5"
                        onSubmit={(event) => submitRename(event, session.id)}
                      >
                        <div class="join w-full">
                          <input
                            class="input input-xs join-item min-w-0 grow"
                            aria-label={`Rename ${session.title}`}
                            value={editTitle}
                            maxLength={120}
                            autofocus
                            onInput={(event) =>
                              setEditTitle(event.currentTarget.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setEditingId(null);
                            }}
                          />
                          <button
                            class="btn btn-xs btn-square join-item"
                            type="submit"
                            aria-label="Save name"
                          >
                            <CheckIcon class="size-3.5" />
                          </button>
                          <button
                            class="btn btn-xs btn-square join-item"
                            type="button"
                            aria-label="Cancel rename"
                            onClick={() => setEditingId(null)}
                          >
                            <CloseIcon class="size-3.5" />
                          </button>
                        </div>
                      </form>
                    </li>
                  );
                }

                return (
                  <li key={session.id} class="group/session relative">
                    <button
                      class={`rounded-field flex w-full min-w-0 flex-col items-stretch gap-1.5 py-3 pr-20 pl-3.5 text-left transition-colors ${
                        active
                          ? "bg-base-300 text-base-content"
                          : "hover:bg-base-300/50"
                      }`}
                      type="button"
                      disabled={busy}
                      aria-current={active ? "page" : undefined}
                      onClick={() => onOpen(session.id)}
                    >
                      <span class="flex min-w-0 items-center gap-2">
                        {active && (
                          <span
                            class="bg-primary h-3.5 w-0.5 shrink-0 rounded-full"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          class={`min-w-0 truncate text-sm ${active ? "font-semibold" : "font-medium"}`}
                        >
                          {session.title}
                        </span>
                        {busy && (
                          <span
                            class="loading loading-spinner loading-xs shrink-0"
                            aria-label="Loading"
                          />
                        )}
                      </span>
                      <span
                        class={`text-base-content/45 flex items-center gap-1.5 text-[0.7rem] tabular-nums ${active ? "pl-2.5" : ""}`}
                      >
                        <span>
                          {dateFormatter.format(new Date(session.updatedAt))}
                        </span>
                        <span class="text-base-content/25" aria-hidden="true">
                          ·
                        </span>
                        <span>{formatCost(session.knownCostMicrousd)}</span>
                        {session.activeJobCount > 0 && (
                          <span
                            class="badge badge-warning badge-sm ml-1 gap-1 font-medium"
                            title={`${session.activeJobCount} job${session.activeJobCount === 1 ? "" : "s"} running`}
                          >
                            <span class="loading loading-spinner size-2.5" />
                            {session.activeJobCount}
                          </span>
                        )}
                      </span>
                    </button>

                    <div class="absolute top-1 right-1.5 flex gap-0.5 opacity-0 transition-opacity group-focus-within/session:opacity-100 group-hover/session:opacity-100 max-md:opacity-100">
                      <button
                        class="btn btn-ghost btn-sm btn-square"
                        type="button"
                        aria-label={`Rename ${session.title}`}
                        title="Rename"
                        onClick={() => {
                          setEditingId(session.id);
                          setEditTitle(session.title);
                        }}
                      >
                        <PencilIcon class="size-4" />
                      </button>
                      <button
                        class="btn btn-ghost btn-sm btn-square hover:text-error"
                        type="button"
                        aria-label={`Delete ${session.title}`}
                        title="Delete"
                        onClick={() => onDelete(session)}
                      >
                        <TrashIcon class="size-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div class="border-base-300 flex items-center gap-2.5 border-t px-5 py-4">
          <span
            class={`status status-md shrink-0 ${connectionStates[connection].dot}`}
            title={connectionStates[connection].label}
            aria-label={connectionStates[connection].label}
          />
          <span class="text-base-content/45 min-w-0 truncate text-xs">
            {user}
          </span>
          {canChangePassword && (
            <button
              class="btn btn-ghost btn-sm btn-square ml-auto shrink-0"
              type="button"
              aria-label="Change password"
              title="Change password"
              onClick={onChangePassword}
            >
              <KeyIcon class="size-4" />
            </button>
          )}
          {canManageUsers && (
            <button
              class={`btn btn-ghost btn-sm btn-square shrink-0 ${canChangePassword ? "" : "ml-auto"}`}
              type="button"
              aria-label="Manage users"
              title="Manage users"
              onClick={onManageUsers}
            >
              <UsersIcon class="size-4" />
            </button>
          )}
          <button
            class={`btn btn-ghost btn-sm btn-square shrink-0 ${canManageUsers || canChangePassword ? "" : "ml-auto"}`}
            type="button"
            aria-label={
              theme === "pictogen-dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
            title="Toggle theme"
            onClick={onToggleTheme}
          >
            {theme === "pictogen-dark" ? (
              <SunIcon class="size-4" />
            ) : (
              <MoonIcon class="size-4" />
            )}
          </button>
          {canLogout && (
            <button
              class="btn btn-ghost btn-sm btn-square shrink-0"
              type="button"
              aria-label="Sign out"
              title="Sign out"
              onClick={onLogout}
            >
              <LogoutIcon class="size-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
