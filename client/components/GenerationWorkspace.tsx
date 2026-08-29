import { useEffect, useState } from "preact/hooks";
import { getReferenceLimitErrors } from "../../shared/capabilities.js";
import { listModels } from "../api.js";
import type {
  Asset,
  ImageModel,
  SessionDetail,
  SessionDraft,
} from "../../shared/contracts.js";
import { CloseIcon, MenuIcon, SlidersIcon } from "./Icons.js";
import { OutputSection } from "./OutputSection.js";
import { PromptPanel } from "./PromptPanel.js";
import { ReferenceGrid } from "./ReferenceGrid.js";
import { SettingsSidebar } from "./SettingsSidebar.js";

function useWideLayout() {
  const [wide, setWide] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 80rem)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(min-width: 80rem)");
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return wide;
}

type SaveStatus = "saved" | "pending" | "saving" | "error";
type Props = {
  session: SessionDetail | null;
  draft: SessionDraft;
  saveStatus: SaveStatus;
  onDraftChange: (draft: SessionDraft) => void;
  onClose: () => void;
  onCreate: () => void;
  onReferenceUploaded: (asset: Asset) => void;
  onReferenceRemoved: (assetId: string) => Promise<boolean>;
  onGenerate: () => void;
  busyItemId: string | null;
  onCancelJob: (jobId: string) => void;
  onDeleteOutput: (assetId: string) => void;
  onDismissJob: (jobId: string) => void;
  onClearGenerationLog: () => void;
};

const saveLabels: Record<SaveStatus, string> = {
  saved: "Saved",
  pending: "Unsaved",
  saving: "Saving",
  error: "Save failed",
};

const saveDots: Record<SaveStatus, string> = {
  saved: "status-success",
  pending: "status-warning",
  saving: "status-info",
  error: "status-error",
};

export function GenerationWorkspace({
  session,
  draft,
  saveStatus,
  onDraftChange,
  onClose,
  onCreate,
  onReferenceUploaded,
  onReferenceRemoved,
  onGenerate,
  busyItemId,
  onCancelJob,
  onDeleteOutput,
  onDismissJob,
  onClearGenerationLog,
}: Props) {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [catalogStale, setCatalogStale] = useState(false);
  const [galleryColumns, setGalleryColumns] = useState(3);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const wideLayout = useWideLayout();
  const referenceLimitErrors = getReferenceLimitErrors(draft, models);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    void listModels(controller.signal)
      .then((catalog) => {
        setModels(catalog.models);
        setCatalogStale(catalog.stale);
        setModelError(catalog.error ?? null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setModelError(
            error instanceof Error
              ? error.message
              : "Models could not be loaded.",
          );
      });
    return () => controller.abort();
  }, [session?.id]);

  useEffect(() => {
    if (!settingsOpen || wideLayout) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, wideLayout]);

  function toggleModel(model: ImageModel) {
    const key = `${model.providerId}:${model.modelId}`;
    if (
      draft.models.some(
        (selection) => `${selection.providerId}:${selection.modelId}` === key,
      )
    ) {
      onDraftChange({
        ...draft,
        models: draft.models.filter(
          (selection) => `${selection.providerId}:${selection.modelId}` !== key,
        ),
      });
    } else if (draft.models.length < 3)
      onDraftChange({
        ...draft,
        models: [
          ...draft.models,
          { providerId: model.providerId, modelId: model.modelId },
        ],
      });
  }

  if (!session)
    return (
      <main class="surface-canvas relative grid min-h-0 grow place-items-center overflow-y-auto p-6">
        <label
          class="btn btn-ghost btn-sm btn-square drawer-button absolute top-3 left-3 lg:hidden"
          for="session-drawer"
          aria-label="Open sessions"
        >
          <MenuIcon class="size-4" />
        </label>
        <section class="text-center">
          <h1 class="text-base-content/70 text-lg font-medium tracking-tight">
            No session selected
          </h1>
          <button
            class="btn btn-primary btn-sm mt-4"
            type="button"
            onClick={onCreate}
          >
            Create session
          </button>
        </section>
      </main>
    );

  const imageCount = session.runs.reduce(
    (total, run) =>
      total +
      run.jobs.reduce((jobTotal, job) => jobTotal + job.outputs.length, 0),
    0,
  );
  const cost = `$${(session.knownCostMicrousd / 1_000_000).toFixed(2)}`;

  return (
    <main class="surface-canvas flex min-h-0 grow flex-col">
      <header class="border-base-300 bg-base-200 flex min-h-14 shrink-0 items-center gap-3 border-b px-3 sm:px-4">
        <label
          class="btn btn-ghost btn-sm btn-square drawer-button lg:hidden"
          for="session-drawer"
          aria-label="Open sessions"
        >
          <MenuIcon class="size-4" />
        </label>

        <div class="min-w-0">
          <h1 class="truncate text-sm font-semibold tracking-tight">
            {session.title}
          </h1>
          <p class="text-base-content/40 truncate text-[0.7rem] tabular-nums">
            {imageCount} image{imageCount === 1 ? "" : "s"} · {cost}
            {session.costComplete ? "" : " known"}
          </p>
        </div>

        <div class="ml-auto flex shrink-0 items-center gap-1">
          <span
            class="text-base-content/45 mr-1 flex items-center gap-1.5 text-xs"
            role="status"
            aria-live="polite"
            title={saveLabels[saveStatus]}
          >
            <span class={`status status-sm ${saveDots[saveStatus]}`} />
            <span class="hidden sm:inline">{saveLabels[saveStatus]}</span>
          </span>

          <button
            class="btn btn-ghost btn-sm btn-square xl:hidden"
            type="button"
            aria-label="Open settings"
            aria-expanded={settingsOpen}
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SlidersIcon class="size-4" />
          </button>

          <button
            class="btn btn-ghost btn-sm btn-square"
            type="button"
            aria-label="Close session"
            title="Close session"
            onClick={onClose}
          >
            <CloseIcon class="size-4" />
          </button>
        </div>
      </header>

      <div class="flex min-h-0 grow">
        <div class="flex min-w-0 grow flex-col">
          <div class="shrink-0 px-3 pt-3 sm:px-4 sm:pt-4">
            <PromptPanel
              draft={draft}
              references={
                <ReferenceGrid
                  session={session}
                  draft={draft}
                  onReferenceUploaded={onReferenceUploaded}
                  onReferenceRemoved={onReferenceRemoved}
                />
              }
              onDraftChange={onDraftChange}
              onGenerate={onGenerate}
              generationBlocked={referenceLimitErrors.length > 0}
              generationBlockMessage={referenceLimitErrors[0]}
            />
          </div>

          <div class="scroll-pane grow px-3 pb-4 sm:px-4">
            <OutputSection
              session={session}
              columns={galleryColumns}
              onColumnsChange={setGalleryColumns}
              busyItemId={busyItemId}
              onCancelJob={onCancelJob}
              onDeleteOutput={onDeleteOutput}
              onDismissJob={onDismissJob}
              onClearGenerationLog={onClearGenerationLog}
            />
          </div>
        </div>

        {settingsOpen && !wideLayout && (
          <button
            class="fixed inset-0 z-30 bg-black/50"
            type="button"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
          />
        )}

        <aside
          class={
            wideLayout
              ? "border-base-300 w-80 shrink-0 border-l"
              : `border-base-300 fixed inset-y-0 right-0 z-40 w-80 max-w-[85vw] border-l transition-transform duration-200 ${
                  settingsOpen ? "translate-x-0" : "translate-x-full"
                }`
          }
          aria-hidden={!wideLayout && !settingsOpen ? "true" : undefined}
          inert={!wideLayout && !settingsOpen ? true : undefined}
        >
          <SettingsSidebar
            draft={draft}
            models={models}
            modelSearch={modelSearch}
            catalogStale={catalogStale}
            modelError={modelError}
            referenceLimitErrors={referenceLimitErrors}
            onDraftChange={onDraftChange}
            onModelSearch={setModelSearch}
            onToggleModel={toggleModel}
            onClose={() => setSettingsOpen(false)}
          />
        </aside>
      </div>
    </main>
  );
}
