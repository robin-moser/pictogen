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
        <section class="mx-auto grid w-full max-w-7xl gap-7 px-5 py-7 sm:px-7 lg:grid-cols-[minmax(0,1fr)_17rem] lg:py-10">
          <div>
            <div class="grid gap-3 lg:grid-cols-[6.5rem_minmax(0,1fr)] lg:gap-4">
              <section aria-labelledby="references-heading">
                <h2 id="references-heading" class="sr-only">
                  Reference images
                </h2>
                <div
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
                  <ul class="flex gap-2 overflow-x-auto pb-1 lg:max-h-80 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pr-1 lg:pb-0">
                    {draftReferences.map((reference, index) => (
                      <li
                        key={reference.id}
                        class="border-base-300 relative size-24 shrink-0 overflow-hidden rounded-box border bg-base-100 p-1 shadow-sm lg:size-[6.25rem]"
                      >
                        <img
                          class="size-full rounded-[calc(var(--radius-box)-0.25rem)] object-cover"
                          src={`/api/assets/${encodeURIComponent(reference.id)}`}
                          alt={`Reference image ${index + 1}`}
                        />
                        <button
                          class="btn btn-error btn-xs btn-square absolute top-2 right-2 shadow-sm"
                          type="button"
                          aria-label={`Remove reference image ${index + 1}`}
                          onClick={() => void onReferenceRemoved(reference.id)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                    <li class="shrink-0">
                      <button
                        class="border-base-300 text-base-content/50 hover:border-base-content/35 hover:text-base-content flex size-24 flex-col items-center justify-center gap-1 rounded-box border border-dashed bg-base-100 text-xs shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 lg:size-[6.25rem]"
                        type="button"
                        disabled={
                          uploading || draft.referenceAssetIds.length >= 20
                        }
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {uploading ? (
                          <span
                            class="loading loading-spinner loading-sm"
                            aria-label="Uploading reference image"
                          />
                        ) : (
                          <>
                            <span
                              class="text-lg leading-none"
                              aria-hidden="true"
                            >
                              +
                            </span>
                            <span>Add</span>
                          </>
                        )}
                      </button>
                    </li>
                  </ul>
                </div>
                {uploadError && (
                  <p class="text-error mt-2 text-xs">{uploadError}</p>
                )}
              </section>

              <section class="border-base-300 focus-within:border-base-content/35 flex min-h-80 flex-col overflow-hidden rounded-box border bg-base-100 shadow-sm transition-colors">
                <h2 class="sr-only">Prompt</h2>
                <textarea
                  class="textarea min-h-0 w-full grow resize-none rounded-none border-0 bg-transparent px-5 py-5 text-base leading-7 focus:outline-none sm:px-6 sm:py-6"
                  aria-label="Image prompt"
                  value={draft.prompt}
                  maxLength={12_000}
                  placeholder="Describe the image you want to generate..."
                  onInput={(event) =>
                    onDraftChange({
                      ...draft,
                      prompt: event.currentTarget.value,
                    })
                  }
                  onKeyDown={(event) => {
                    if (
                      (event.ctrlKey || event.metaKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      if (draft.prompt.trim() && draft.models.length)
                        onGenerate();
                    }
                  }}
                />
                <div class="border-base-300 flex min-h-16 items-center justify-between gap-4 border-t px-4 py-3 sm:px-5">
                  <span class="text-base-content/45 text-xs tabular-nums">
                    {draft.prompt.length.toLocaleString()} chars
                  </span>
                  <button
                    class="btn btn-primary min-w-28"
                    type="button"
                    disabled={!draft.prompt.trim() || !draft.models.length}
                    onClick={onGenerate}
                  >
                    Generate
                  </button>
                </div>
              </section>
            </div>
          </div>

          <aside
            class="border-base-300 rounded-box border bg-base-100 p-5 shadow-sm"
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

            <section
              class="border-base-300 mt-7 border-t pt-5"
              aria-labelledby="models-heading"
            >
              <div class="flex items-baseline justify-between gap-4">
                <h3 id="models-heading" class="font-semibold">
                  Models
                </h3>
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

            <div class="border-base-300 text-base-content/50 mt-7 border-t pt-5 text-xs leading-5">
              Autosave enabled
            </div>
          </aside>
        </section>
        {session.runs.length > 0 && (
          <section class="border-base-300 bg-base-300/35 border-t px-5 py-7 sm:px-7">
            <div class="mx-auto max-w-6xl">
              <h2 class="text-lg font-semibold">Output</h2>
              <div class="mt-4 grid gap-5">
                {session.runs.map((run) => (
                  <article
                    key={run.id}
                    class="border-base-300 rounded-box border bg-base-100 p-4 shadow-sm"
                  >
                    <p class="text-base-content/60 text-sm whitespace-pre-wrap">
                      {run.prompt}
                    </p>
                    <div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {run.jobs.map((job) => (
                        <section key={job.id} class="bg-base-200/40 p-3">
                          <div class="flex justify-between gap-2 text-sm">
                            <strong>{job.modelName}</strong>
                            <span>{job.status}</span>
                          </div>
                          {job.errorMessage && (
                            <p class="text-error mt-2 text-xs">
                              {job.errorMessage}
                            </p>
                          )}
                          {job.outputs.length > 0 && (
                            <div class="mt-3 grid grid-cols-2 gap-2">
                              {job.outputs.map((output, index) => (
                                <img
                                  key={output.id}
                                  class="bg-base-300 aspect-square w-full object-cover"
                                  loading="lazy"
                                  src={`/api/assets/${encodeURIComponent(output.id)}`}
                                  alt={`Generated image ${index + 1} for ${job.modelName}`}
                                />
                              ))}
                            </div>
                          )}
                          {(job.status === "queued" ||
                            job.status === "running") && (
                            <p class="text-base-content/60 mt-3 text-xs">
                              {job.completedCount} / {job.requestedCount} images
                              complete
                            </p>
                          )}
                        </section>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
