import { useEffect, useRef, useState } from "preact/hooks";

import { listModels, uploadReference } from "../api.js";
import type {
  Asset,
  ImageModel,
  SessionDetail,
  SessionDraft,
} from "../../shared/contracts.js";

type SaveStatus = "saved" | "pending" | "saving" | "error";

type GenerationWorkspaceProps = {
  session: SessionDetail | null;
  draft: SessionDraft;
  saveStatus: SaveStatus;
  onDraftChange: (draft: SessionDraft) => void;
  onClose: () => void;
  onCreate: () => void;
  onReferenceUploaded: (asset: Asset) => void;
  onReferenceRemoved: (assetId: string) => Promise<boolean>;
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
}: GenerationWorkspaceProps) {
  const [models, setModels] = useState<ImageModel[]>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [modelError, setModelError] = useState<string | null>(null);
  const [catalogStale, setCatalogStale] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session) {
      return;
    }

    const controller = new AbortController();
    void listModels(controller.signal)
      .then((catalog) => {
        setModels(catalog.models);
        setCatalogStale(catalog.stale);
        setModelError(catalog.error ?? null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setModelError(
            error instanceof Error
              ? error.message
              : "Models could not be loaded.",
          );
        }
      });

    return () => controller.abort();
  }, [session?.id]);

  const selectedModelKeys = new Set(
    draft.models.map((model) => `${model.providerId}:${model.modelId}`),
  );
  const normalizedSearch = modelSearch.trim().toLocaleLowerCase();
  const visibleModels = models.filter((model) =>
    [model.providerId, model.modelId, model.name, model.description]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
  );
  const draftReferences = draft.referenceAssetIds
    .map((id) => session?.references.find((reference) => reference.id === id))
    .filter((reference): reference is Asset => Boolean(reference));

  async function addFiles(files: FileList | File[]) {
    if (!session || uploading) {
      return;
    }

    const file = files[0];
    if (!file) {
      return;
    }

    if (draft.referenceAssetIds.length >= 20) {
      setUploadError("A draft can include at most 20 reference images.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      onReferenceUploaded(await uploadReference(session.id, file));
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "The reference could not be uploaded.",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function toggleModel(model: ImageModel) {
    const key = `${model.providerId}:${model.modelId}`;
    if (selectedModelKeys.has(key)) {
      onDraftChange({
        ...draft,
        models: draft.models.filter(
          (selection) => `${selection.providerId}:${selection.modelId}` !== key,
        ),
      });
      return;
    }

    if (draft.models.length < 3) {
      onDraftChange({
        ...draft,
        models: [
          ...draft.models,
          { providerId: model.providerId, modelId: model.modelId },
        ],
      });
    }
  }

  if (!session) {
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
  }

  return (
    <main class="bg-base-100 flex min-h-0 grow flex-col">
      <header class="border-base-300 flex min-h-20 items-center justify-between gap-4 border-b px-5 py-4 sm:px-7">
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
        <section class="mx-auto grid w-full max-w-6xl gap-7 px-5 py-7 sm:px-7 lg:grid-cols-[minmax(0,1fr)_17rem] lg:py-10">
          <div>
            <div class="flex items-end justify-between gap-4">
              <h2 class="text-lg font-semibold">Prompt</h2>
              <span class="text-base-content/45 text-xs tabular-nums">
                {draft.prompt.length.toLocaleString()} / 12,000
              </span>
            </div>
            <textarea
              class="textarea textarea-lg mt-4 min-h-52 w-full resize-y leading-7"
              aria-label="Image prompt"
              value={draft.prompt}
              maxLength={12_000}
              placeholder="Enter prompt"
              onInput={(event) =>
                onDraftChange({ ...draft, prompt: event.currentTarget.value })
              }
            />

            <section class="mt-7" aria-labelledby="models-heading">
              <div class="flex items-baseline justify-between gap-4">
                <h2 id="models-heading" class="text-lg font-semibold">
                  Models
                </h2>
                <span class="text-base-content/45 text-xs">
                  {draft.models.length} / 3 selected
                </span>
              </div>
              <input
                class="input mt-4 w-full"
                type="search"
                value={modelSearch}
                placeholder="Search models"
                aria-label="Search image models"
                onInput={(event) => setModelSearch(event.currentTarget.value)}
              />
              {draft.models.length > 0 && (
                <div
                  class="mt-3 flex flex-wrap gap-2"
                  aria-label="Selected models"
                >
                  {draft.models.map((selection) => {
                    const model = models.find(
                      (candidate) =>
                        candidate.providerId === selection.providerId &&
                        candidate.modelId === selection.modelId,
                    );
                    return (
                      <button
                        class="badge badge-outline h-auto gap-1.5 py-1.5 pr-1.5"
                        type="button"
                        onClick={() =>
                          toggleModel(
                            model ?? {
                              ...selection,
                              name: selection.modelId,
                              inputModalities: ["text"],
                            },
                          )
                        }
                      >
                        {model?.name ?? selection.modelId}
                        <span aria-hidden="true">×</span>
                        <span class="sr-only">Remove</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {catalogStale && (
                <p class="text-warning mt-3 text-xs">
                  Showing a cached model catalog.
                </p>
              )}
              {modelError && (
                <p class="text-error mt-3 text-xs">{modelError}</p>
              )}
              <div class="border-base-300 mt-3 max-h-64 overflow-y-auto border">
                {visibleModels.length === 0 ? (
                  <p class="text-base-content/50 px-3 py-4 text-sm">
                    No models found.
                  </p>
                ) : (
                  <ul class="divide-base-300 divide-y">
                    {visibleModels.map((model) => {
                      const selected = selectedModelKeys.has(
                        `${model.providerId}:${model.modelId}`,
                      );
                      return (
                        <li key={`${model.providerId}:${model.modelId}`}>
                          <button
                            class="hover:bg-base-200 flex w-full items-start justify-between gap-4 px-3 py-3 text-left disabled:cursor-not-allowed"
                            type="button"
                            disabled={!selected && draft.models.length >= 3}
                            aria-pressed={selected}
                            onClick={() => toggleModel(model)}
                          >
                            <span>
                              <span class="block text-sm font-medium">
                                {model.name}
                              </span>
                              <span class="text-base-content/50 mt-0.5 block text-xs">
                                {model.providerId} / {model.modelId}
                              </span>
                              {model.description && (
                                <span class="text-base-content/60 mt-1 block text-xs leading-5">
                                  {model.description}
                                </span>
                              )}
                            </span>
                            {selected && (
                              <span class="badge badge-primary">Selected</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>

            <section class="mt-7" aria-labelledby="references-heading">
              <div class="flex items-baseline justify-between gap-4">
                <h2 id="references-heading" class="text-lg font-semibold">
                  References
                </h2>
                <span class="text-base-content/45 text-xs">
                  {draftReferences.length} / 20
                </span>
              </div>
              <div
                class="border-base-300 bg-base-200/40 mt-4 border border-dashed p-4"
                tabindex={0}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (event.dataTransfer) {
                    void addFiles(event.dataTransfer.files);
                  }
                }}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData?.files ?? []);
                  if (files.length) {
                    event.preventDefault();
                    void addFiles(files);
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  class="sr-only"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) =>
                    void addFiles(event.currentTarget.files ?? [])
                  }
                />
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <p class="text-base-content/60 text-sm">
                    Drop or paste a PNG, JPEG, or WebP image.
                  </p>
                  <button
                    class="btn btn-sm"
                    type="button"
                    disabled={uploading || draft.referenceAssetIds.length >= 20}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? "Uploading" : "Choose image"}
                  </button>
                </div>
              </div>
              {uploadError && (
                <p class="text-error mt-2 text-xs">{uploadError}</p>
              )}
              {draftReferences.length > 0 && (
                <ul class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {draftReferences.map((reference, index) => (
                    <li
                      key={reference.id}
                      class="border-base-300 relative border p-1.5"
                    >
                      <img
                        class="bg-base-200 aspect-square w-full object-cover"
                        src={`/api/assets/${encodeURIComponent(reference.id)}`}
                        alt={`Reference image ${index + 1}`}
                      />
                      <button
                        class="btn btn-error btn-xs absolute top-2 right-2 btn-square"
                        type="button"
                        aria-label={`Remove reference image ${index + 1}`}
                        onClick={() => void onReferenceRemoved(reference.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside
            class="lg:border-base-300 lg:border-l lg:pl-7"
            aria-labelledby="settings-heading"
          >
            <h2 id="settings-heading" class="text-lg font-semibold">
              Settings
            </h2>

            <div class="mt-5 grid gap-5 sm:grid-cols-3 lg:grid-cols-1">
              <label class="grid gap-2 text-xs font-semibold">
                Resolution
                <select
                  class="select w-full font-normal"
                  value={draft.resolution}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      resolution: event.currentTarget
                        .value as SessionDraft["resolution"],
                    })
                  }
                >
                  <option value="512">512</option>
                  <option value="1K">1K</option>
                  <option value="2K">2K</option>
                  <option value="4K">4K</option>
                </select>
              </label>

              <label class="grid gap-2 text-xs font-semibold">
                Aspect ratio
                <select
                  class="select w-full font-normal"
                  value={draft.aspectRatio}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      aspectRatio: event.currentTarget
                        .value as SessionDraft["aspectRatio"],
                    })
                  }
                >
                  <option value="1:1">1:1 Square</option>
                  <option value="16:9">16:9 Landscape</option>
                  <option value="9:16">9:16 Portrait</option>
                  <option value="4:3">4:3 Landscape</option>
                  <option value="3:4">3:4 Portrait</option>
                  <option value="3:2">3:2 Landscape</option>
                  <option value="2:3">2:3 Portrait</option>
                </select>
              </label>

              <label class="grid gap-2 text-xs font-semibold">
                Images per model
                <select
                  class="select w-full font-normal"
                  value={draft.count}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      count: Number(event.currentTarget.value),
                    })
                  }
                >
                  {Array.from({ length: 10 }, (_, index) => index + 1).map(
                    (count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>

            <div class="border-base-300 text-base-content/50 mt-7 border-t pt-5 text-xs leading-5">
              Autosave enabled
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
