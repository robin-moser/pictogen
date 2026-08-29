import { useState } from "preact/hooks";

import type { SessionSummary } from "../../shared/contracts.js";
import {
  CheckIcon,
  CloseIcon,
  MoonIcon,
  PencilIcon,
  PlusIcon,
  SunIcon,
  TrashIcon,
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
  sessions: SessionSummary[];
  activeSessionId: string | null;
  user: string;
  connection: ConnectionState;
  busySessionId: string | null;
  theme: Theme;
  onToggleTheme: () => void;
  onCreate: (title: string) => Promise<boolean>;
  onOpen: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<boolean>;
  onDelete: (session: SessionSummary) => void;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

function formatCost(microusd: number) {
  return `$${(microusd / 1_000_000).toFixed(2)}`;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  user,
  connection,
  busySessionId,
  theme,
  onToggleTheme,
  onCreate,
  onOpen,
  onRename,
  onDelete,
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
    <aside class="border-base-300 bg-base-200 flex min-h-full w-72 flex-col border-r">
      <div class="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <a class="flex min-w-0 items-center gap-2.5" href="/">
          <span
            class="bg-primary text-primary-content grid size-7 shrink-0 place-items-center rounded-field text-[0.7rem] font-bold tracking-tight"
            aria-hidden="true"
          >
            PG
          </span>
          <span class="truncate text-sm font-semibold tracking-tight">
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
      </div>

      {creating && (
        <form class="px-3 pb-3" onSubmit={submitCreate}>
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

      <div class="flex items-center justify-between px-4 pt-1 pb-2">
        <h2 class="field-legend">Sessions</h2>
        <span class="text-base-content/40 text-xs tabular-nums">
          {sessions.length}
        </span>
      </div>

      <nav class="scroll-pane grow px-2 pb-3" aria-label="Saved sessions">
        {sessions.length === 0 ? (
          <p class="text-base-content/40 px-2 py-6 text-center text-xs">
            No sessions yet.
          </p>
        ) : (
          <ul class="flex flex-col gap-0.5">
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
                    class={`rounded-field flex w-full min-w-0 flex-col items-stretch gap-1 py-2 pr-14 pl-3 text-left transition-colors ${
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
                          class="status status-warning status-xs ml-0.5"
                          title={`${session.activeJobCount} running`}
                        />
                      )}
                    </span>
                  </button>

                  <div class="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 transition-opacity group-focus-within/session:opacity-100 group-hover/session:opacity-100 max-md:opacity-100">
                    <button
                      class="btn btn-ghost btn-xs btn-square"
                      type="button"
                      aria-label={`Rename ${session.title}`}
                      title="Rename"
                      onClick={() => {
                        setEditingId(session.id);
                        setEditTitle(session.title);
                      }}
                    >
                      <PencilIcon class="size-3.5" />
                    </button>
                    <button
                      class="btn btn-ghost btn-xs btn-square hover:text-error"
                      type="button"
                      aria-label={`Delete ${session.title}`}
                      title="Delete"
                      onClick={() => onDelete(session)}
                    >
                      <TrashIcon class="size-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div class="border-base-300 flex items-center gap-2 border-t px-4 py-2.5">
        <span
          class={`status status-sm shrink-0 ${connectionStates[connection].dot}`}
          title={connectionStates[connection].label}
          aria-label={connectionStates[connection].label}
        />
        <span class="text-base-content/45 min-w-0 truncate text-xs">
          {user}
        </span>
        <button
          class="btn btn-ghost btn-xs btn-square ml-auto shrink-0"
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
      </div>
    </aside>
  );
}
