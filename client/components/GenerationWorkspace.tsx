import { useEffect, useState } from "preact/hooks";
import { listModels } from "../api.js";
import type {
  Asset,
  ImageModel,
  SessionDetail,
  SessionDraft,
} from "../../shared/contracts.js";
import { OutputSection } from "./OutputSection.js";
import { PromptPanel } from "./PromptPanel.js";
import { ReferenceGrid } from "./ReferenceGrid.js";
import { SettingsSidebar } from "./SettingsSidebar.js";

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
};
const saveLabels: Record<SaveStatus, string> = {
  saved: "Saved",
  pending: "Unsaved changes",
  saving: "Saving",
  error: "Save failed",
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
}: Props) {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [catalogStale, setCatalogStale] = useState(false);
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
      <main class="studio-grid grid min-h-0 grow place-items-center overflow-y-auto px-5 py-12">
        <section class="bg-base-100 border-base-300 w-full max-w-sm border p-7 shadow-sm">
          <h1 class="text-xl font-semibold tracking-tight">
            No session selected
          </h1>
          <button class="btn btn-primary mt-5" type="button" onClick={onCreate}>
            Create session
          </button>
        </section>
      </main>
    );
  return (
    <main class="bg-base-200 flex min-h-0 grow flex-col">
      <header class="border-base-300 bg-base-100 flex min-h-20 items-center justify-between gap-4 border-b px-5 py-4 sm:px-7">
        <div class="min-w-0">
          <p class="text-base-content/45 text-[0.65rem] font-bold tracking-[0.16em] uppercase">
            Active session
          </p>
          <h1 class="mt-1 truncate text-xl font-semibold tracking-tight">
            {session.title}
          </h1>
        </div>
        <div class="flex shrink-0 items-center gap-3">
          <span
            class={`text-xs font-medium ${saveStatus === "error" ? "text-error" : "text-base-content/50"}`}
            role="status"
            aria-live="polite"
          >
            {saveStatus === "saving" && (
              <span
                class="loading loading-spinner loading-xs mr-1.5 align-middle"
                aria-hidden="true"
              />
            )}
            {saveLabels[saveStatus]}
          </span>
          <button class="btn btn-ghost btn-sm" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>
      <div class="min-h-0 grow overflow-y-auto">
        <section class="grid min-h-full w-full lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div class="min-w-0 px-5 py-7 sm:px-7 lg:px-10 lg:py-10">
            <div class="grid gap-3 lg:grid-cols-[6.5rem_minmax(0,1fr)] lg:gap-4">
              <ReferenceGrid
                session={session}
                draft={draft}
                onReferenceUploaded={onReferenceUploaded}
                onReferenceRemoved={onReferenceRemoved}
              />
              <PromptPanel
                draft={draft}
                onDraftChange={onDraftChange}
                onGenerate={onGenerate}
              />
            </div>
            <OutputSection session={session} />
          </div>
          <SettingsSidebar
            draft={draft}
            models={models}
            modelSearch={modelSearch}
            catalogStale={catalogStale}
            modelError={modelError}
            onDraftChange={onDraftChange}
            onModelSearch={setModelSearch}
            onToggleModel={toggleModel}
          />
        </section>
      </div>
    </main>
  );
}
