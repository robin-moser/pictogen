import { useEffect, useRef, useState } from "preact/hooks";

import {
  cancelJob,
  clearGenerationLog,
  createSession,
  createRun,
  deleteAsset,
  deleteSession,
  dismissJob,
  getIdentity,
  getSession,
  listSessions,
  updateSession,
} from "./api.js";
import { GenerationWorkspace } from "./components/GenerationWorkspace.js";
import { SessionSidebar } from "./components/SessionSidebar.js";
import type {
  SessionDetail,
  SessionDraft,
  SessionSummary,
  Asset,
} from "../shared/contracts.js";
import { createEmptyDraft } from "../shared/contracts.js";

type ConnectionState = "checking" | "connected" | "unavailable";
type SaveStatus = "saved" | "pending" | "saving" | "error";
type Theme = "pictogen-dark" | "pictogen-light";

const themeStorageKey = "pictogen-theme";

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    return stored === "pictogen-dark" || stored === "pictogen-light"
      ? stored
      : null;
  } catch {
    return null;
  }
}

function preferredTheme(): Theme {
  return (
    readStoredTheme() ??
    (window.matchMedia("(prefers-color-scheme: light)").matches
      ? "pictogen-light"
      : "pictogen-dark")
  );
}

function summaryFromDetail(detail: SessionDetail): SessionSummary {
  return {
    id: detail.id,
    title: detail.title,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    knownCostMicrousd: detail.knownCostMicrousd,
    costComplete: detail.costComplete,
    activeJobCount: detail.activeJobCount,
  };
}

function sortSessions(sessions: SessionSummary[]) {
  return [...sessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function setSessionUrl(sessionId: string | null) {
  const url = new URL(window.location.href);

  if (sessionId) {
    url.searchParams.set("session", sessionId);
  } else {
    url.searchParams.delete("session");
  }

  window.history.replaceState(null, "", url);
}

export function App() {
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [user, setUser] = useState("user");
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<SessionDetail | null>(
    null,
  );
  const [draft, setDraft] = useState<SessionDraft>(createEmptyDraft);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(preferredTheme);

  const activeSessionRef = useRef<SessionDetail | null>(null);
  const draftRef = useRef(draft);
  const persistedDraftRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const sessionRequestRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyItemRef = useRef<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      // A blocked storage write must not break the theme switch.
    }
  }, [theme]);

  function updateSessionList(detail: SessionDetail) {
    const summary = summaryFromDetail(detail);
    setSessions((current) =>
      sortSessions([
        summary,
        ...current.filter((item) => item.id !== summary.id),
      ]),
    );
  }

  function activate(detail: SessionDetail | null) {
    activeSessionRef.current = detail;
    setActiveSession(detail);

    if (detail) {
      draftRef.current = detail.draft;
      persistedDraftRef.current = JSON.stringify(detail.draft);
      setDraft(detail.draft);
      setSaveStatus("saved");
    } else {
      const emptyDraft = createEmptyDraft();
      draftRef.current = emptyDraft;
      persistedDraftRef.current = "";
      setDraft(emptyDraft);
      setSaveStatus("saved");
    }
  }

  async function saveCurrentDraft(): Promise<boolean> {
    if (savePromiseRef.current) {
      await savePromiseRef.current;
    }

    const session = activeSessionRef.current;
    const draftToSave = draftRef.current;
    const serializedDraft = JSON.stringify(draftToSave);

    if (!session || serializedDraft === persistedDraftRef.current) {
      return true;
    }

    setSaveStatus("saving");
    const save = updateSession(session.id, { draft: draftToSave })
      .then((updated) => {
        persistedDraftRef.current = serializedDraft;
        updateSessionList(updated);

        if (activeSessionRef.current?.id === updated.id) {
          const currentDetail = { ...updated, draft: draftRef.current };
          activeSessionRef.current = currentDetail;
          setActiveSession(currentDetail);
          setSaveStatus(
            JSON.stringify(draftRef.current) === serializedDraft
              ? "saved"
              : "pending",
          );
        }

        return true;
      })
      .catch((saveError: unknown) => {
        setSaveStatus("error");
        setError(
          saveError instanceof Error
            ? saveError.message
            : "The draft could not be saved.",
        );
        return false;
      })
      .finally(() => {
        savePromiseRef.current = null;
      });

    savePromiseRef.current = save;
    return save;
  }

  async function flushDraft() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    return saveCurrentDraft();
  }

  useEffect(() => {
    const controller = new AbortController();

    async function loadWorkspace() {
      try {
        const [identity, sessionList] = await Promise.all([
          getIdentity(controller.signal),
          listSessions(controller.signal),
        ]);
        setUser(identity.user);
        setSessions(sessionList);
        setConnection("connected");

        const requestedSessionId = new URL(
          window.location.href,
        ).searchParams.get("session");

        if (requestedSessionId) {
          try {
            const detail = await getSession(
              requestedSessionId,
              controller.signal,
            );
            activate(detail);
          } catch (sessionError) {
            if (!controller.signal.aborted) {
              setSessionUrl(null);
              setError(
                sessionError instanceof Error
                  ? sessionError.message
                  : "The session could not be opened.",
              );
            }
          }
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setConnection("unavailable");
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The workspace could not be loaded.",
          );
        }
      }
    }

    void loadWorkspace();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    if (!activeSession || JSON.stringify(draft) === persistedDraftRef.current) {
      return;
    }

    setSaveStatus("pending");
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void saveCurrentDraft();
    }, 700);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [activeSession?.id, draft]);

  function changeDraft(nextDraft: SessionDraft) {
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }

  function refreshSession(sessionId: string) {
    return getSession(sessionId).then((detail) => {
      if (activeSessionRef.current?.id === detail.id) {
        activeSessionRef.current = detail;
        setActiveSession(detail);
        updateSessionList(detail);
      }
      return detail;
    });
  }

  useEffect(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (!activeSession || !activeSession.activeJobCount) return;
    const sessionId = activeSession.id;
    let stopped = false;

    function schedulePoll() {
      pollTimerRef.current = setTimeout(
        async () => {
          pollTimerRef.current = null;
          let keepPolling = true;
          try {
            const detail = await refreshSession(sessionId);
            keepPolling = detail.activeJobCount > 0;
          } catch {
            // A transient refresh failure should not strand an active placeholder.
          }
          if (
            !stopped &&
            keepPolling &&
            activeSessionRef.current?.id === sessionId
          ) {
            schedulePoll();
          }
        },
        document.hidden ? 8_000 : 2_000,
      );
    }

    schedulePoll();
    return () => {
      stopped = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [activeSession?.id, activeSession?.activeJobCount]);

  async function handleGenerate() {
    const session = activeSessionRef.current;
    if (!session || !(await flushDraft())) return;
    try {
      setError(null);
      const { run } = await createRun(session.id, {
        prompt: draftRef.current.prompt,
        models: draftRef.current.models,
        count: draftRef.current.count,
        options: {
          resolution: draftRef.current.resolution,
          aspectRatio: draftRef.current.aspectRatio,
          ...(draftRef.current.quality
            ? { quality: draftRef.current.quality }
            : {}),
          ...(draftRef.current.background
            ? { background: draftRef.current.background }
            : {}),
          ...(draftRef.current.outputFormat
            ? { outputFormat: draftRef.current.outputFormat }
            : {}),
          ...(draftRef.current.outputCompression !== undefined
            ? { outputCompression: draftRef.current.outputCompression }
            : {}),
        },
        referenceAssetIds: draftRef.current.referenceAssetIds,
      });
      const queuedSession = { ...session, runs: [run, ...session.runs] };
      activeSessionRef.current = queuedSession;
      setActiveSession(queuedSession);
      await refreshSession(session.id);
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "The generation could not be submitted.",
      );
    }
  }

  async function mutateSessionItem(
    itemId: string,
    mutation: () => Promise<unknown>,
    failureMessage: string,
  ) {
    const sessionId = activeSessionRef.current?.id;
    if (!sessionId || busyItemRef.current) return;

    busyItemRef.current = itemId;
    setBusyItemId(itemId);
    setError(null);
    try {
      try {
        await mutation();
      } catch (mutationError) {
        setError(
          mutationError instanceof Error
            ? mutationError.message
            : failureMessage,
        );
        return;
      }

      try {
        if (activeSessionRef.current?.id === sessionId) {
          await refreshSession(sessionId);
        }
      } catch {
        setError(
          "The change was saved, but the session could not be refreshed.",
        );
      }
    } finally {
      busyItemRef.current = null;
      setBusyItemId(null);
    }
  }

  function handleCancelJob(jobId: string) {
    return mutateSessionItem(
      jobId,
      () => cancelJob(jobId),
      "The job could not be cancelled.",
    );
  }

  function handleDeleteOutput(assetId: string) {
    return mutateSessionItem(
      assetId,
      () => deleteAsset(assetId),
      "The image could not be deleted.",
    );
  }

  function handleDismissJob(jobId: string) {
    return mutateSessionItem(
      jobId,
      () => dismissJob(jobId),
      "The log entry could not be removed.",
    );
  }

  function handleClearGenerationLog() {
    const sessionId = activeSessionRef.current?.id;
    if (!sessionId) return;
    return mutateSessionItem(
      sessionId,
      () => clearGenerationLog(sessionId),
      "The generation log could not be cleared.",
    );
  }

  async function handleCreate(title: string) {
    if (!(await flushDraft())) {
      return false;
    }

    try {
      setError(null);
      const created = await createSession(title);
      updateSessionList(created);
      activate(created);
      setSessionUrl(created.id);
      setDrawerOpen(false);
      return true;
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "The session could not be created.",
      );
      return false;
    }
  }

  async function handleOpen(sessionId: string) {
    setDrawerOpen(false);

    if (sessionId === activeSessionRef.current?.id) {
      return;
    }

    if (!(await flushDraft())) {
      return;
    }

    const requestId = ++sessionRequestRef.current;
    setBusySessionId(sessionId);
    setError(null);

    try {
      const detail = await getSession(sessionId);

      if (requestId === sessionRequestRef.current) {
        activate(detail);
        setSessionUrl(detail.id);
      }
    } catch (openError) {
      if (requestId === sessionRequestRef.current) {
        setError(
          openError instanceof Error
            ? openError.message
            : "The session could not be opened.",
        );
      }
    } finally {
      if (requestId === sessionRequestRef.current) {
        setBusySessionId(null);
      }
    }
  }

  async function handleClose() {
    if (!(await flushDraft())) {
      return;
    }

    sessionRequestRef.current += 1;
    activate(null);
    setSessionUrl(null);
  }

  async function handleRename(sessionId: string, title: string) {
    try {
      setError(null);
      const updated = await updateSession(sessionId, { title });
      updateSessionList(updated);

      if (activeSessionRef.current?.id === sessionId) {
        const currentDetail = { ...updated, draft: draftRef.current };
        activeSessionRef.current = currentDetail;
        setActiveSession(currentDetail);
      }

      return true;
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : "The session could not be renamed.",
      );
      return false;
    }
  }

  async function handleDelete(session: SessionSummary) {
    if (!window.confirm(`Delete “${session.title}”? This cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      await deleteSession(session.id);
      setSessions((current) =>
        current.filter((item) => item.id !== session.id),
      );

      if (activeSessionRef.current?.id === session.id) {
        sessionRequestRef.current += 1;
        activate(null);
        setSessionUrl(null);
      }
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "The session could not be deleted.",
      );
    }
  }

  function handleReferenceUploaded(asset: Asset) {
    const current = activeSessionRef.current;
    if (!current || current.id !== asset.sessionId) {
      return;
    }

    const nextDraft = {
      ...draftRef.current,
      referenceAssetIds: [...draftRef.current.referenceAssetIds, asset.id],
    };
    const detail = {
      ...current,
      references: [...current.references, asset],
      draft: nextDraft,
    };
    activeSessionRef.current = detail;
    setActiveSession(detail);
    changeDraft(nextDraft);
  }

  async function handleReferenceRemoved(assetId: string) {
    const nextDraft = {
      ...draftRef.current,
      referenceAssetIds: draftRef.current.referenceAssetIds.filter(
        (referenceId) => referenceId !== assetId,
      ),
    };
    changeDraft(nextDraft);
    return true;
  }

  function handleRestoreOutput(
    run: SessionDetail["runs"][number],
    job: SessionDetail["runs"][number]["jobs"][number],
  ) {
    const session = activeSessionRef.current;
    if (!session) return;
    const outputIds = new Set(
      session.runs.flatMap((currentRun) =>
        currentRun.jobs.flatMap((currentJob) =>
          currentJob.outputs.map((output) => output.id),
        ),
      ),
    );
    const availableReferenceIds = new Set([
      ...session.references.map((reference) => reference.id),
      ...outputIds,
    ]);
    changeDraft({
      ...draftRef.current,
      prompt: run.prompt,
      referenceAssetIds: job.referenceAssetIds.filter((assetId) =>
        availableReferenceIds.has(assetId),
      ),
    });
  }

  function handleAddOutputReference(assetId: string) {
    if (draftRef.current.referenceAssetIds.includes(assetId)) return;
    if (draftRef.current.referenceAssetIds.length >= 20) {
      setError("A draft can include at most 20 reference images.");
      return;
    }
    changeDraft({
      ...draftRef.current,
      referenceAssetIds: [...draftRef.current.referenceAssetIds, assetId],
    });
  }

  return (
    <div class="drawer lg:drawer-open h-dvh">
      <input
        id="session-drawer"
        class="drawer-toggle"
        type="checkbox"
        checked={drawerOpen}
        onChange={(event) => setDrawerOpen(event.currentTarget.checked)}
      />

      <div class="drawer-content flex min-h-0 flex-col overflow-hidden">
        {error && (
          <div class="toast toast-center toast-bottom z-50 w-full max-w-md">
            <div class="alert alert-error text-sm" role="alert">
              <span class="min-w-0">{error}</span>
              <button
                class="btn btn-ghost btn-xs ml-auto shrink-0"
                type="button"
                aria-label="Dismiss error"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <GenerationWorkspace
          session={activeSession}
          draft={draft}
          saveStatus={saveStatus}
          onDraftChange={changeDraft}
          onClose={() => void handleClose()}
          onCreate={() => void handleCreate("Untitled session")}
          onReferenceUploaded={handleReferenceUploaded}
          onReferenceRemoved={handleReferenceRemoved}
          onGenerate={() => void handleGenerate()}
          busyItemId={busyItemId}
          onCancelJob={(jobId) => void handleCancelJob(jobId)}
          onDeleteOutput={(assetId) => void handleDeleteOutput(assetId)}
          onRestoreOutput={handleRestoreOutput}
          onAddOutputReference={handleAddOutputReference}
          onDismissJob={(jobId) => void handleDismissJob(jobId)}
          onClearGenerationLog={() => void handleClearGenerationLog()}
        />
      </div>

      <div class="drawer-side z-20">
        <label
          class="drawer-overlay"
          for="session-drawer"
          aria-label="Close sessions"
        />
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSession?.id ?? null}
          user={user}
          connection={connection}
          busySessionId={busySessionId}
          theme={theme}
          onToggleTheme={() =>
            setTheme((current) =>
              current === "pictogen-dark" ? "pictogen-light" : "pictogen-dark",
            )
          }
          onCreate={handleCreate}
          onOpen={(sessionId) => void handleOpen(sessionId)}
          onRename={handleRename}
          onDelete={(session) => void handleDelete(session)}
        />
      </div>
    </div>
  );
}
