import { useState } from "preact/hooks";

import type { SessionSummary } from "../../shared/contracts.js";

type SessionSidebarProps = {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  user: string;
  busySessionId: string | null;
  onCreate: (title: string) => Promise<boolean>;
  onOpen: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<boolean>;
  onDelete: (session: SessionSummary) => void;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

export function SessionSidebar({
  sessions,
  activeSessionId,
  user,
  busySessionId,
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
    <aside class="border-base-300 bg-base-300 flex min-h-full w-[19rem] flex-col border-r">
      <div class="border-base-300 bg-base-200 border-b px-5 py-5">
        <div class="flex items-center justify-between gap-3">
          <a class="group flex items-center gap-3" href="/">
            <span
              class="bg-base-content text-base-100 grid size-8 place-items-center rounded-field text-xs font-black tracking-tighter"
              aria-hidden="true"
            >
              PG
            </span>
            <span>
              <span class="block text-sm font-bold tracking-tight">
                Pictogen
              </span>
              <span class="text-base-content/45 block text-[0.65rem] font-semibold tracking-[0.18em] uppercase">
                Image generation
              </span>
            </span>
          </a>
        </div>
      </div>

      <div class="flex items-center justify-between px-5 pt-5 pb-3">
        <div>
          <h2 class="text-xs font-bold tracking-[0.14em] uppercase">
            Sessions
          </h2>
          <p class="text-base-content/45 mt-0.5 text-xs">
            {sessions.length} saved
          </p>
        </div>
        <button
          class="btn btn-sm btn-square"
          type="button"
          aria-label="Create session"
          title="Create session"
          onClick={() => setCreating((value) => !value)}
        >
          <span class="text-lg leading-none" aria-hidden="true">
            +
          </span>
        </button>
      </div>

      {creating && (
        <form class="px-3 pb-3" onSubmit={submitCreate}>
          <label
            class="text-base-content/60 mb-1.5 block px-2 text-xs font-medium"
            for="new-session-title"
          >
            Session name
          </label>
          <div class="flex gap-2">
            <input
              id="new-session-title"
              class="input input-sm min-w-0 grow"
              value={createTitle}
              maxLength={120}
              placeholder="Untitled session"
              autofocus
              onInput={(event) => setCreateTitle(event.currentTarget.value)}
            />
            <button class="btn btn-sm" type="submit">
              Create
            </button>
          </div>
        </form>
      )}

      <nav
        class="min-h-0 grow overflow-y-auto px-3 pb-4"
        aria-label="Saved sessions"
      >
        {sessions.length === 0 ? (
          <div class="border-base-300 mx-2 mt-3 border-t pt-5">
            <p class="text-sm font-medium">No sessions</p>
          </div>
        ) : (
          <ul class="menu menu-sm w-full gap-1 p-0">
            {sessions.map((session) => {
              const active = session.id === activeSessionId;
              const editing = session.id === editingId;
              const busy = session.id === busySessionId;

              return (
                <li key={session.id}>
                  {editing ? (
                    <form
                      class="border-base-300 bg-base-100 rounded-field border p-2 shadow-sm"
                      onSubmit={(event) => submitRename(event, session.id)}
                    >
                      <input
                        class="input input-sm w-full"
                        aria-label={`Rename ${session.title}`}
                        value={editTitle}
                        maxLength={120}
                        autofocus
                        onInput={(event) =>
                          setEditTitle(event.currentTarget.value)
                        }
                      />
                      <div class="mt-2 flex justify-end gap-1">
                        <button
                          class="btn btn-ghost btn-xs"
                          type="button"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </button>
                        <button class="btn btn-xs" type="submit">
                          Save
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div
                      class={`group/session relative rounded-field border-l-2 p-0 ${
                        active
                          ? "border-primary bg-base-100 shadow-sm"
                          : "border-transparent"
                      }`}
                    >
                      <button
                        class="flex w-full min-w-0 flex-col items-stretch gap-1 px-3 py-2.5 pr-16 text-left"
                        type="button"
                        disabled={busy}
                        aria-current={active ? "page" : undefined}
                        onClick={() => onOpen(session.id)}
                      >
                        <span class="flex min-w-0 items-center gap-2">
                          {busy && (
                            <span
                              class="loading loading-spinner loading-xs"
                              aria-label="Loading"
                            />
                          )}
                          <span class="min-w-0 truncate font-medium">
                            {session.title}
                          </span>
                        </span>
                        <span class="text-base-content/45 flex gap-2 text-[0.68rem]">
                          <span>
                            {dateFormatter.format(new Date(session.updatedAt))}
                          </span>
                          <span aria-hidden="true">/</span>
                          <span>
                            $
                            {(session.knownCostMicrousd / 1_000_000).toFixed(2)}
                          </span>
                        </span>
                      </button>
                      <div class="absolute top-1.5 right-1 flex opacity-100 md:opacity-0 md:group-hover/session:opacity-100 md:group-focus-within/session:opacity-100">
                        <button
                          class="btn btn-ghost btn-xs px-1.5"
                          type="button"
                          aria-label={`Rename ${session.title}`}
                          title="Rename"
                          onClick={() => {
                            setEditingId(session.id);
                            setEditTitle(session.title);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          class="btn btn-ghost btn-xs text-error px-1.5"
                          type="button"
                          aria-label={`Delete ${session.title}`}
                          title="Delete"
                          onClick={() => onDelete(session)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div class="border-base-300 bg-base-200 text-base-content/55 border-t px-5 py-3 text-xs">
        Workspace for <span class="text-base-content font-medium">{user}</span>
      </div>
    </aside>
  );
}
