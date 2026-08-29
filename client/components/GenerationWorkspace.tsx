import { useEffect, useState } from "preact/hooks";
import { getReferenceLimitErrors } from "../../shared/capabilities.js";
import { listModels } from "../api.js";
import type {
  Asset,
  ImageModel,
  SessionDetail,
  SessionDraft,
} from "../../shared/contracts.js";
import { MenuIcon, SlidersIcon } from "./Icons.js";
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

type Props = {
  session: SessionDetail | null;
  draft: SessionDraft;
  onDraftChange: (draft: SessionDraft) => void;
  onCreate: () => void;
  onReferenceUploaded: (asset: Asset) => void;
  onReferenceRemoved: (assetId: string) => Promise<boolean>;
  onGenerate: () => void;
  busyItemId: string | null;
  onCancelJob: (jobId: string) => void;
  onDeleteOutput: (assetId: string) => void;
  onToggleOutputStar: (assetId: string, starred: boolean) => void;
  onRestoreOutput: (
    run: SessionDetail["runs"][number],
    job: SessionDetail["runs"][number]["jobs"][number],
  ) => void;
  onAddOutputReference: (assetId: string) => void;
  onDismissJob: (jobId: string) => void;
  onClearGenerationLog: () => void;
};

export function GenerationWorkspace({
  session,
  draft,
  onDraftChange,
  onCreate,
  onReferenceUploaded,
  onReferenceRemoved,
  onGenerate,
  busyItemId,
  onCancelJob,
  onDeleteOutput,
  onToggleOutputStar,
  onRestoreOutput,
  onAddOutputReference,
  onDismissJob,
  onClearGenerationLog,
}: Props) {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [catalogStale, setCatalogStale] = useState(false);
  const [galleryColumns, setGalleryColumns] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 47.999rem)").matches
      ? 1
      : 3,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(false);
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
    } else
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
      <main class="empty-workspace relative grid min-h-0 grow place-items-center overflow-hidden p-6">
        <label
          class="btn border-base-content/10 bg-base-100/80 btn-sm btn-square drawer-button absolute top-4 left-4 shadow-sm backdrop-blur lg:hidden"
          for="session-drawer"
          aria-label="Open sessions"
        >
          <MenuIcon class="size-4" />
        </label>
        <section class="relative flex max-w-sm flex-col items-center text-center">
          <div class="empty-canvas-mark mb-8" aria-hidden="true">
            <span class="empty-canvas-focus" />
          </div>
          <h1 class="text-base-content text-xl font-semibold tracking-[-0.025em]">
            Start a new image session
          </h1>
          <p class="text-base-content/45 mt-2 text-sm leading-6">
            Choose a saved session or create a new one.
          </p>
          <button
            class="btn btn-primary mt-6 min-w-32"
            type="button"
            onClick={onCreate}
          >
            Create session
          </button>
        </section>
      </main>
    );

  return (
    <main class="surface-canvas relative flex min-h-0 grow flex-col">
      <div class="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4">
        <label
          class="btn border-base-content/10 bg-base-100/85 btn-sm btn-square drawer-button pointer-events-auto shadow-sm backdrop-blur lg:hidden"
          for="session-drawer"
          aria-label="Open sessions"
        >
          <MenuIcon class="size-4" />
        </label>
        <button
          class="btn border-base-content/10 bg-base-100/85 btn-sm btn-square pointer-events-auto ml-auto shadow-sm backdrop-blur xl:hidden"
          type="button"
          aria-label="Open settings"
          aria-expanded={settingsOpen}
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <SlidersIcon class="size-4" />
        </button>
      </div>

      <div class="flex min-h-0 grow">
        <div class="flex min-w-0 grow flex-col max-md:scroll-pane">
          {!outputExpanded && (
            <div class="shrink-0 px-4 pt-18 sm:px-6 lg:px-8 xl:pt-8">
              <PromptPanel
                draft={draft}
                settingsControl={
                  wideLayout && settingsCollapsed ? (
                    <button
                      class="btn border-base-content/10 bg-base-100 btn-sm btn-square shadow-sm"
                      type="button"
                      aria-label="Expand settings"
                      title="Expand settings"
                      onClick={() => setSettingsCollapsed(false)}
                    >
                      <SlidersIcon class="size-4" />
                    </button>
                  ) : undefined
                }
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
          )}

          <div
            class={`scroll-pane grow px-4 pb-8 max-md:shrink-0 max-md:overflow-visible sm:px-6 lg:px-8 ${outputExpanded ? "pt-14 xl:pt-0" : ""}`}
          >
            <OutputSection
              session={session}
              columns={galleryColumns}
              onColumnsChange={setGalleryColumns}
              busyItemId={busyItemId}
              onCancelJob={onCancelJob}
              onDeleteOutput={onDeleteOutput}
              onToggleOutputStar={onToggleOutputStar}
              onRestoreOutput={onRestoreOutput}
              onAddOutputReference={onAddOutputReference}
              onDismissJob={onDismissJob}
              onClearGenerationLog={onClearGenerationLog}
              outputExpanded={outputExpanded}
              onToggleOutputExpanded={() =>
                setOutputExpanded((expanded) => !expanded)
              }
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

        {!outputExpanded && (!wideLayout || !settingsCollapsed) && (
          <aside
            class={
              wideLayout
                ? "border-base-300 m-8 ml-0 w-88 shrink-0 overflow-hidden rounded-box border shadow-sm"
                : `border-base-300 fixed top-4 right-4 bottom-4 z-40 w-88 max-w-[calc(100vw-2rem)] overflow-hidden rounded-box border shadow-xl transition-transform duration-200 sm:top-6 sm:right-6 sm:bottom-6 sm:max-w-[calc(100vw-3rem)] ${
                    settingsOpen
                      ? "translate-x-0"
                      : "translate-x-[calc(100%+1.5rem)]"
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
              onClose={() =>
                wideLayout ? setSettingsCollapsed(true) : setSettingsOpen(false)
              }
            />
          </aside>
        )}
      </div>
    </main>
  );
}
