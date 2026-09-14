import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { SessionGroup, SessionSummary } from "../../shared/contracts.js";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EllipsisHorizontalIcon,
  FolderPlusIcon,
  InfoIcon,
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
type SessionDropPosition = "before" | "after" | "group";
type GroupDropPosition = "before" | "after";
type DropTarget =
  | { kind: "session"; id: string; position: SessionDropPosition }
  | { kind: "group"; id: string }
  | { kind: "group-position"; id: string; position: GroupDropPosition }
  | { kind: "ungrouped" };

type ActionMenu =
  | { kind: "session"; id: string; anchor: HTMLElement }
  | { kind: "group"; id: string; anchor: HTMLElement };

const sessionDragType = "application/x-pictogen-session";
const groupDragType = "application/x-pictogen-session-group";

const connectionStates: Record<
  ConnectionState,
  { label: string; dot: string }
> = {
  checking: { label: "Connecting", dot: "status-neutral" },
  connected: { label: "Connected", dot: "status-success" },
  unavailable: { label: "Unavailable", dot: "status-error" },
};

const appVersion = import.meta.env.VITE_APP_VERSION
  ? `v${import.meta.env.VITE_APP_VERSION}`
  : "dev";

type SessionSidebarProps = {
  collapsed: boolean;
  sessions: SessionSummary[];
  groups: SessionGroup[];
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
  onCreateGroup: (title: string) => Promise<boolean>;
  onOpen: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => Promise<boolean>;
  onRenameGroup: (groupId: string, title: string) => Promise<boolean>;
  onMoveGroup: (groupId: string, beforeGroupId: string | null) => void;
  onDeleteGroup: (group: SessionGroup) => void;
  onMove: (
    sessionId: string,
    groupId: string | null,
    beforeSessionId?: string | null,
  ) => void;
  onGroupSession: (sessionId: string, targetId: string) => void;
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
  groups,
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
  onCreateGroup,
  onOpen,
  onRename,
  onRenameGroup,
  onMoveGroup,
  onDeleteGroup,
  onMove,
  onGroupSession,
  onDelete,
  onCollapse,
  onExpand,
}: SessionSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupTitle, setCreateGroupTitle] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupTitle, setEditGroupTitle] = useState("");
  const [openGroupIds, setOpenGroupIds] = useState<Set<string>>(new Set());
  const knownGroupIds = useRef<Set<string>>(new Set());
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [actionMenu, setActionMenu] = useState<ActionMenu | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const actionMenuElement = useRef<HTMLUListElement>(null);

  const archivedGroup = groups.find((group) => group.isArchived);
  const visibleGroups = groups.filter(
    (group) =>
      !group.isArchived ||
      sessions.some((session) => session.groupId === group.id),
  );
  const actionSession =
    actionMenu?.kind === "session"
      ? sessions.find((session) => session.id === actionMenu.id)
      : undefined;
  const actionGroup =
    actionMenu?.kind === "group"
      ? groups.find((group) => group.id === actionMenu.id)
      : undefined;

  useEffect(() => {
    const known = knownGroupIds.current;
    setOpenGroupIds((current) => {
      const next = new Set(
        [...current].filter((groupId) =>
          groups.some((group) => group.id === groupId && !group.isArchived),
        ),
      );
      for (const group of groups) {
        if (!group.isArchived && !known.has(group.id)) next.add(group.id);
        if (group.isArchived) next.delete(group.id);
      }
      return next;
    });
    knownGroupIds.current = new Set(groups.map((group) => group.id));
  }, [groups]);

  useLayoutEffect(() => {
    if (!actionMenu || !actionMenuElement.current) return;

    const margin = 8;
    const gap = 4;
    const anchor = actionMenu.anchor.getBoundingClientRect();
    const menu = actionMenuElement.current.getBoundingClientRect();
    const maximumLeft = Math.max(
      margin,
      window.innerWidth - menu.width - margin,
    );
    const below = anchor.bottom + gap;
    setActionMenuPosition({
      left: Math.min(Math.max(anchor.right - menu.width, margin), maximumLeft),
      top:
        below + menu.height <= window.innerHeight - margin
          ? below
          : Math.max(margin, anchor.top - gap - menu.height),
    });
    actionMenuElement.current
      .querySelector<HTMLButtonElement>("button")
      ?.focus();
  }, [actionMenu]);

  useEffect(() => {
    if (!actionMenu) return;

    function dismissActionMenu(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        (actionMenuElement.current?.contains(target) ||
          actionMenu?.anchor.contains(target))
      ) {
        return;
      }
      setActionMenu(null);
    }

    function closeActionMenu(restoreFocus = false) {
      const anchor = actionMenu?.anchor;
      setActionMenu(null);
      if (restoreFocus) queueMicrotask(() => anchor?.focus());
    }

    function dismissOnFocusChange(event: FocusEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        (actionMenuElement.current?.contains(target) ||
          actionMenu?.anchor.contains(target))
      ) {
        return;
      }
      closeActionMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeActionMenu(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        return;
      }

      const items = Array.from(
        actionMenuElement.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? [],
      );
      if (items.length === 0) return;
      const currentIndex = items.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowUp"
              ? (currentIndex - 1 + items.length) % items.length
              : (currentIndex + 1) % items.length;
      event.preventDefault();
      items[nextIndex]?.focus();
    }

    function closeOnViewportChange() {
      closeActionMenu();
    }

    document.addEventListener("pointerdown", dismissActionMenu);
    document.addEventListener("focusin", dismissOnFocusChange);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", dismissActionMenu);
      document.removeEventListener("focusin", dismissOnFocusChange);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [actionMenu]);

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

  async function submitCreateGroup(event: SubmitEvent) {
    event.preventDefault();
    if (await onCreateGroup(createGroupTitle.trim() || "Untitled group")) {
      setCreateGroupTitle("");
      setCreatingGroup(false);
    }
  }

  async function submitRenameGroup(event: SubmitEvent, groupId: string) {
    event.preventDefault();
    const title = editGroupTitle.trim();
    if (title && (await onRenameGroup(groupId, title))) {
      setEditingGroupId(null);
    }
  }

  function sessionIdFromDrop(event: DragEvent) {
    return draggedSessionId ?? event.dataTransfer?.getData(sessionDragType);
  }

  function groupIdFromDrop(event: DragEvent) {
    return draggedGroupId ?? event.dataTransfer?.getData(groupDragType);
  }

  function isGroupDrag(event: DragEvent) {
    return (
      draggedGroupId !== null ||
      event.dataTransfer?.types.includes(groupDragType) === true
    );
  }

  function isSessionDrag(event: DragEvent) {
    return (
      draggedSessionId !== null ||
      event.dataTransfer?.types.includes(sessionDragType) === true
    );
  }

  function sessionDropPosition(
    event: DragEvent,
    target: SessionSummary,
  ): SessionDropPosition {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const position = (event.clientY - bounds.top) / bounds.height;
    if (target.groupId !== null) return position < 0.5 ? "before" : "after";
    if (position < 0.25) return "before";
    if (position > 0.75) return "after";
    return "group";
  }

  function sessionAfter(target: SessionSummary, sourceId: string) {
    const siblings = sessions.filter(
      (session) =>
        session.groupId === target.groupId && session.id !== sourceId,
    );
    const targetIndex = siblings.findIndex(
      (session) => session.id === target.id,
    );
    return siblings[targetIndex + 1]?.id ?? null;
  }

  function groupDropPosition(
    event: DragEvent,
    target: SessionGroup,
  ): GroupDropPosition {
    if (target.isArchived) return "before";
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientY - bounds.top < bounds.height / 2 ? "before" : "after";
  }

  function groupAfter(target: SessionGroup, sourceId: string) {
    const siblings = groups.filter(
      (group) => !group.isArchived && group.id !== sourceId,
    );
    const targetIndex = siblings.findIndex((group) => group.id === target.id);
    return siblings[targetIndex + 1]?.id ?? null;
  }

  function clearDropTarget(event: DragEvent) {
    const relatedTarget = event.relatedTarget;
    const currentTarget = event.currentTarget as HTMLElement;
    if (
      !(relatedTarget instanceof Node) ||
      !currentTarget.contains(relatedTarget)
    ) {
      setDropTarget(null);
    }
  }

  function toggleActionMenu(
    event: MouseEvent,
    kind: ActionMenu["kind"],
    id: string,
  ) {
    const anchor = event.currentTarget as HTMLElement;
    setActionMenuPosition(null);
    setActionMenu((current) =>
      current?.kind === kind && current.id === id ? null : { kind, id, anchor },
    );
  }

  function dropOnGroup(event: DragEvent, group: SessionGroup) {
    event.preventDefault();
    event.stopPropagation();
    const draggedGroup = groupIdFromDrop(event);
    if (draggedGroup && draggedGroup !== group.id) {
      const position = groupDropPosition(event, group);
      const beforeGroupId = group.isArchived
        ? null
        : position === "after"
          ? groupAfter(group, draggedGroup)
          : group.id;
      onMoveGroup(draggedGroup, beforeGroupId);
    }
    const sessionId = sessionIdFromDrop(event);
    if (!draggedGroup && sessionId) onMove(sessionId, group.id);
    setDraggedSessionId(null);
    setDraggedGroupId(null);
    setDropTarget(null);
  }

  function dropSessionOnSession(event: DragEvent, target: SessionSummary) {
    if (isGroupDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const sessionId = sessionIdFromDrop(event);
    if (sessionId && sessionId !== target.id) {
      const position = sessionDropPosition(event, target);
      if (position === "group") {
        onGroupSession(sessionId, target.id);
      } else {
        onMove(
          sessionId,
          target.groupId,
          position === "before" ? target.id : sessionAfter(target, sessionId),
        );
      }
    }
    setDraggedSessionId(null);
    setDropTarget(null);
  }

  function dropSessionToUngrouped(event: DragEvent) {
    if (isGroupDrag(event)) return;
    event.preventDefault();
    const sessionId = sessionIdFromDrop(event);
    if (sessionId) {
      const firstSession = sessions.find(
        (session) => session.groupId === null && session.id !== sessionId,
      );
      onMove(sessionId, null, firstSession?.id ?? null);
    }
    setDraggedSessionId(null);
    setDropTarget(null);
  }

  function renderSession(session: SessionSummary) {
    const active = session.id === activeSessionId;
    const editing = session.id === editingId;
    const busy = session.id === busySessionId;
    const sessionTarget =
      dropTarget?.kind === "session" && dropTarget.id === session.id
        ? dropTarget.position
        : null;
    const insertionTarget =
      sessionTarget === "before" || sessionTarget === "after"
        ? sessionTarget
        : null;

    if (editing) {
      return (
        <li key={session.id}>
          <form
            class="bg-base-100 border-base-300 rounded-field border p-1.5"
            onSubmit={(event) => submitRename(event, session.id)}
          >
            <div class="join rounded-field focus-within:outline-base-content w-full focus-within:outline-2 focus-within:outline-offset-2">
              <input
                class="input input-xs join-item min-w-0 grow focus:outline-none"
                aria-label={`Rename ${session.title}`}
                value={editTitle}
                maxLength={120}
                autofocus
                onInput={(event) => setEditTitle(event.currentTarget.value)}
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
      <li
        key={session.id}
        class="group/session relative"
        onDragOver={(event) => {
          if (isGroupDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
          if (draggedSessionId === session.id) {
            setDropTarget(null);
            return;
          }
          setDropTarget({
            kind: "session",
            id: session.id,
            position: sessionDropPosition(event, session),
          });
        }}
        onDragLeave={clearDropTarget}
        onDrop={(event) => dropSessionOnSession(event, session)}
      >
        {insertionTarget && (
          <span
            class={`bg-primary pointer-events-none absolute z-20 h-0.5 rounded-full ${
              insertionTarget === "before" ? "-top-1" : "-bottom-1"
            } ${session.groupId === null ? "right-0 left-0" : "right-2 left-4"}`}
            aria-hidden="true"
          />
        )}
        <button
          class={`rounded-field flex w-full min-w-0 flex-col items-stretch gap-1.5 py-3 pr-12 pl-3.5 text-left transition-colors ${
            active ? "bg-base-300 text-base-content" : "hover:bg-base-300/50"
          } ${sessionTarget === "group" ? "ring-primary ring-2 ring-inset" : ""}`}
          type="button"
          disabled={busy}
          draggable={!busy}
          aria-current={active ? "page" : undefined}
          onDragStart={(event) => {
            setActionMenu(null);
            setDraggedSessionId(session.id);
            event.dataTransfer?.setData(sessionDragType, session.id);
            event.dataTransfer?.setData("text/plain", session.id);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            setDraggedSessionId(null);
            setDraggedGroupId(null);
            setDropTarget(null);
          }}
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
            <span>{dateFormatter.format(new Date(session.updatedAt))}</span>
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

        <button
          class="btn btn-ghost btn-sm btn-square absolute top-1 right-1.5 z-10 opacity-60 transition-opacity hover:opacity-100"
          type="button"
          aria-label={`Actions for ${session.title}`}
          aria-expanded={
            actionMenu?.kind === "session" && actionMenu.id === session.id
          }
          aria-haspopup="menu"
          title="Session actions"
          onClick={(event) => toggleActionMenu(event, "session", session.id)}
        >
          <EllipsisHorizontalIcon class="size-4" />
        </button>
      </li>
    );
  }

  const ungroupedSessions = sessions.filter(
    (session) => session.groupId === null,
  );

  return (
    <aside
      class={`border-base-300 bg-base-200 h-full min-h-0 w-76 flex-col border-r transition-[width] duration-200 ${collapsed ? "hidden lg:flex lg:w-16" : "flex"}`}
    >
      <div
        class={`${collapsed ? "flex" : "hidden"} h-full min-h-0 flex-col items-center py-5`}
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
        class={`h-full min-h-0 flex-col ${collapsed ? "flex lg:hidden" : "flex"}`}
      >
        <div class="flex shrink-0 items-center gap-3 px-5 pt-5 pb-5">
          <a class="flex min-w-0 items-center gap-2.5" href="/">
            <img
              class="size-9 shrink-0"
              src="/logo.svg"
              alt=""
              width="38"
              height="38"
            />
            <h1 class="brand-wordmark text-xl leading-none">Pictogen</h1>
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
            class="btn btn-ghost btn-sm btn-square shrink-0"
            type="button"
            aria-label="New group"
            aria-expanded={creatingGroup}
            title="New group"
            onClick={() => setCreatingGroup((value) => !value)}
          >
            {creatingGroup ? (
              <CloseIcon class="size-4" />
            ) : (
              <FolderPlusIcon class="size-4" />
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
          <form class="shrink-0 px-4 pb-5" onSubmit={submitCreate}>
            <div class="join rounded-field focus-within:outline-base-content w-full focus-within:outline-2 focus-within:outline-offset-2">
              <input
                id="new-session-title"
                class="input input-sm join-item min-w-0 grow focus:outline-none"
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

        {creatingGroup && (
          <form class="shrink-0 px-4 pb-5" onSubmit={submitCreateGroup}>
            <div class="join rounded-field focus-within:outline-base-content w-full focus-within:outline-2 focus-within:outline-offset-2">
              <input
                id="new-session-group-title"
                class="input input-sm join-item min-w-0 grow focus:outline-none"
                value={createGroupTitle}
                maxLength={120}
                placeholder="Group name"
                aria-label="New group name"
                autofocus
                onInput={(event) =>
                  setCreateGroupTitle(event.currentTarget.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Escape") setCreatingGroup(false);
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

        <div
          class="relative flex shrink-0 items-center justify-between px-5 pt-1 pb-3"
          onDragOver={(event) => {
            if (isGroupDrag(event)) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            setDropTarget({ kind: "ungrouped" });
          }}
          onDragLeave={clearDropTarget}
          onDrop={dropSessionToUngrouped}
        >
          {dropTarget?.kind === "ungrouped" && (
            <span
              class="bg-primary pointer-events-none absolute right-3 bottom-0 left-3 h-0.5 rounded-full"
              aria-hidden="true"
            />
          )}
          <h2 class="field-legend">Sessions</h2>
          <span class="text-base-content/40 text-xs tabular-nums">
            {sessions.length}
          </span>
        </div>

        <nav
          class="scroll-pane min-h-0 grow px-3 pb-5"
          aria-label="Saved sessions"
        >
          {sessions.length === 0 ? (
            <p class="text-base-content/40 px-2 py-6 text-center text-xs">
              No sessions yet.
            </p>
          ) : (
            <ul class="flex flex-col gap-1.5">
              {ungroupedSessions.map(renderSession)}
              {visibleGroups.map((group) => {
                const groupSessions = sessions.filter(
                  (session) => session.groupId === group.id,
                );
                const open = openGroupIds.has(group.id);
                const editing = editingGroupId === group.id;
                const groupPositionTarget =
                  dropTarget?.kind === "group-position" &&
                  dropTarget.id === group.id
                    ? dropTarget.position
                    : null;
                return (
                  <li key={group.id} class="relative">
                    {groupPositionTarget && (
                      <span
                        class={`bg-primary pointer-events-none absolute z-20 h-0.5 rounded-full ${
                          groupPositionTarget === "before"
                            ? "-top-1"
                            : "-bottom-1"
                        } right-0 left-0`}
                        aria-hidden="true"
                      />
                    )}
                    <div
                      class={`group rounded-field border-base-300/70 flex min-w-0 items-center gap-1 border px-1.5 py-1 ${
                        dropTarget?.kind === "group" &&
                        dropTarget.id === group.id
                          ? "ring-primary ring-2 ring-inset"
                          : ""
                      }`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.dataTransfer)
                          event.dataTransfer.dropEffect = "move";
                        if (isGroupDrag(event)) {
                          if (draggedGroupId === group.id) {
                            setDropTarget(null);
                            return;
                          }
                          setDropTarget({
                            kind: "group-position",
                            id: group.id,
                            position: groupDropPosition(event, group),
                          });
                        } else if (isSessionDrag(event)) {
                          setDropTarget({ kind: "group", id: group.id });
                        }
                      }}
                      onDragLeave={clearDropTarget}
                      onDrop={(event) => dropOnGroup(event, group)}
                    >
                      <button
                        class="btn btn-ghost btn-xs min-w-0 grow justify-start gap-1.5 px-1.5 font-semibold"
                        type="button"
                        draggable={!group.isArchived && !editing}
                        aria-expanded={open}
                        onDragStart={(event) => {
                          setActionMenu(null);
                          setDraggedGroupId(group.id);
                          event.dataTransfer?.setData(groupDragType, group.id);
                          event.dataTransfer?.setData("text/plain", group.id);
                          if (event.dataTransfer)
                            event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => {
                          setDraggedGroupId(null);
                          setDropTarget(null);
                        }}
                        onClick={() =>
                          setOpenGroupIds((current) => {
                            const next = new Set(current);
                            if (next.has(group.id)) next.delete(group.id);
                            else next.add(group.id);
                            return next;
                          })
                        }
                      >
                        <ChevronRightIcon
                          class={`size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                        />
                        <span class="min-w-0 truncate">{group.title}</span>
                        <span class="text-base-content/40 ml-auto text-xs tabular-nums">
                          {groupSessions.length}
                        </span>
                      </button>
                      {!group.isArchived && !editing ? (
                        <button
                          class="btn btn-ghost btn-xs btn-square shrink-0 opacity-60 transition-opacity hover:opacity-100"
                          type="button"
                          aria-label={`Actions for ${group.title}`}
                          aria-expanded={
                            actionMenu?.kind === "group" &&
                            actionMenu.id === group.id
                          }
                          aria-haspopup="menu"
                          title="Group actions"
                          onClick={(event) =>
                            toggleActionMenu(event, "group", group.id)
                          }
                        >
                          <EllipsisHorizontalIcon class="size-3.5" />
                        </button>
                      ) : (
                        <span class="size-6 shrink-0" aria-hidden="true" />
                      )}
                    </div>
                    {editing && (
                      <form
                        class="mt-1 px-1"
                        onSubmit={(event) => submitRenameGroup(event, group.id)}
                      >
                        <div class="join rounded-field focus-within:outline-base-content w-full focus-within:outline-2 focus-within:outline-offset-2">
                          <input
                            class="input input-xs join-item min-w-0 grow focus:outline-none"
                            aria-label={`Rename ${group.title}`}
                            value={editGroupTitle}
                            maxLength={120}
                            autofocus
                            onInput={(event) =>
                              setEditGroupTitle(event.currentTarget.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape")
                                setEditingGroupId(null);
                            }}
                          />
                          <button
                            class="btn btn-xs btn-square join-item"
                            type="submit"
                            aria-label="Save group name"
                          >
                            <CheckIcon class="size-3.5" />
                          </button>
                          <button
                            class="btn btn-xs btn-square join-item"
                            type="button"
                            aria-label="Cancel group rename"
                            onClick={() => setEditingGroupId(null)}
                          >
                            <CloseIcon class="size-3.5" />
                          </button>
                        </div>
                      </form>
                    )}
                    {open && groupSessions.length > 0 && (
                      <ul class="mt-1 ml-2 flex flex-col gap-1.5 border-l border-base-300 pl-1.5">
                        {groupSessions.map(renderSession)}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div class="border-base-300 relative flex shrink-0 items-center gap-2.5 border-t px-5 py-4">
          <span
            class={`status status-md shrink-0 ${connectionStates[connection].dot}`}
            title={connectionStates[connection].label}
            aria-label={connectionStates[connection].label}
          />
          <span class="text-base-content/45 min-w-0 truncate text-xs">
            {user}
          </span>
          <details class="dropdown dropdown-top static ml-auto shrink-0">
            <summary
              class="btn btn-ghost btn-sm btn-square list-none"
              aria-label="About Pictogen"
              title="About Pictogen"
            >
              <InfoIcon class="size-4" />
            </summary>
            <div class="dropdown-content text-center bg-base-100 border-base-300 absolute right-5 bottom-full left-auto z-20 mb-2 w-44 rounded-box border p-3 shadow-lg">
              <p class="text-base-content text-xs font-medium">
                Pictogen {appVersion}
              </p>
              <div class="text-base-content/50 mt-2 flex items-center justify-center gap-2 text-xs">
                <a
                  class="link link-hover"
                  href="https://github.com/robin-moser/pictogen"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>
                <span aria-hidden="true">·</span>
                <a
                  class="link link-hover"
                  href="https://github.com/robin-moser/pictogen/blob/main/LICENSE"
                  target="_blank"
                  rel="noreferrer"
                >
                  MIT License
                </a>
              </div>
            </div>
          </details>
          {canChangePassword && (
            <button
              class="btn btn-ghost btn-sm btn-square shrink-0"
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
              class="btn btn-ghost btn-sm btn-square shrink-0"
              type="button"
              aria-label="Manage users"
              title="Manage users"
              onClick={onManageUsers}
            >
              <UsersIcon class="size-4" />
            </button>
          )}
          <button
            class="btn btn-ghost btn-sm btn-square shrink-0"
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

      {actionMenu &&
        (actionSession || actionGroup) &&
        typeof document !== "undefined" &&
        createPortal(
          <ul
            ref={actionMenuElement}
            class="menu bg-base-100 border-base-300 rounded-box fixed z-[100] w-36 border p-1 shadow-xl"
            style={{
              left: `${actionMenuPosition?.left ?? 0}px`,
              top: `${actionMenuPosition?.top ?? 0}px`,
              visibility: actionMenuPosition ? "visible" : "hidden",
            }}
            role="menu"
          >
            {actionSession && (
              <>
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionMenu(null);
                      setEditingId(actionSession.id);
                      setEditTitle(actionSession.title);
                    }}
                  >
                    <PencilIcon class="size-4" />
                    Rename
                  </button>
                </li>
                {archivedGroup && (
                  <li>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setActionMenu(null);
                        onMove(
                          actionSession.id,
                          actionSession.groupId === archivedGroup.id
                            ? null
                            : archivedGroup.id,
                        );
                      }}
                    >
                      <ArchiveIcon class="size-4" />
                      {actionSession.groupId === archivedGroup.id
                        ? "Restore"
                        : "Archive"}
                    </button>
                  </li>
                )}
                <li>
                  <button
                    class="text-error"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionMenu(null);
                      onDelete(actionSession);
                    }}
                  >
                    <TrashIcon class="size-4" />
                    Delete
                  </button>
                </li>
              </>
            )}
            {actionGroup && !actionGroup.isArchived && (
              <>
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionMenu(null);
                      setEditingGroupId(actionGroup.id);
                      setEditGroupTitle(actionGroup.title);
                    }}
                  >
                    <PencilIcon class="size-4" />
                    Rename
                  </button>
                </li>
                <li>
                  <button
                    class="text-error"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setActionMenu(null);
                      onDeleteGroup(actionGroup);
                    }}
                  >
                    <TrashIcon class="size-4" />
                    Delete
                  </button>
                </li>
              </>
            )}
          </ul>,
          document.body,
        )}
    </aside>
  );
}
