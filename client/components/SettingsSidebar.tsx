import type { ImageModel, SessionDraft } from "../../shared/contracts.js";
import { resolveEffectiveOptions } from "../../shared/capabilities.js";

type Props = {
  draft: SessionDraft;
  models: ImageModel[];
  modelSearch: string;
  catalogStale: boolean;
  modelError: string | null;
  referenceLimitErrors: string[];
  onDraftChange: (draft: SessionDraft) => void;
  onModelSearch: (value: string) => void;
  onToggleModel: (model: ImageModel) => void;
};
export function SettingsSidebar({
  draft,
  models,
  modelSearch,
  catalogStale,
  modelError,
  referenceLimitErrors,
  onDraftChange,
  onModelSearch,
  onToggleModel,
}: Props) {
  const selected = new Set(
    draft.models.map((model) => `${model.providerId}:${model.modelId}`),
  );
  const selectedModels = draft.models.map(
    (selection): ImageModel =>
      models.find(
        (model) =>
          model.providerId === selection.providerId &&
          model.modelId === selection.modelId,
      ) ?? {
        ...selection,
        name: selection.modelId,
        inputModalities: ["text"],
      },
  );
  const availableModels = models.filter(
    (model) => !selected.has(`${model.providerId}:${model.modelId}`),
  );
  const visibleModels = availableModels.filter((model) =>
    [model.providerId, model.modelId, model.name, model.description]
      .filter((value): value is string => Boolean(value))
      .some((value) =>
        value
          .toLocaleLowerCase()
          .includes(modelSearch.trim().toLocaleLowerCase()),
      ),
  );
  const capabilityWarnings = selectedModels.flatMap((model) =>
    resolveEffectiveOptions(model, draft).changes.map(
      (change) => `${model.name}: ${change}.`,
    ),
  );
  function clearOutputOption(
    option: "quality" | "background" | "outputFormat" | "outputCompression",
  ) {
    const nextDraft = { ...draft };
    switch (option) {
      case "quality":
        delete nextDraft.quality;
        break;
      case "background":
        delete nextDraft.background;
        break;
      case "outputFormat":
        delete nextDraft.outputFormat;
        break;
      case "outputCompression":
        delete nextDraft.outputCompression;
        break;
    }
    onDraftChange(nextDraft);
  }
  return (
    <aside
      class="border-base-300 min-h-full border-y-0 border-r-0 bg-base-300 p-5 shadow-none lg:border-l"
      aria-labelledby="settings-heading"
    >
      <h2 id="settings-heading" class="text-lg font-semibold">
        Settings
      </h2>
      <section
        class="border-base-300 mt-5 border-t pt-5"
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
        {selectedModels.length > 0 && (
          <ul class="mt-4 grid gap-2" aria-label="Selected models">
            {selectedModels.map((model) => (
              <li
                key={`${model.providerId}:${model.modelId}`}
                class="card card-border bg-base-100"
              >
                <div class="card-body flex-row items-center gap-3 p-3">
                  <div class="min-w-0 grow">
                    <p class="truncate text-sm font-medium">{model.name}</p>
                    <p class="text-base-content/50 truncate text-xs">
                      {model.modelId}
                    </p>
                  </div>
                  <button
                    class="btn btn-ghost btn-xs shrink-0"
                    type="button"
                    onClick={() => onToggleModel(model)}
                    aria-label={`Remove ${model.name}`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <input
          class="input input-sm mt-4 w-full"
          type="search"
          value={modelSearch}
          placeholder="Search the model catalog"
          aria-label="Search image models"
          onInput={(event) => onModelSearch(event.currentTarget.value)}
        />
        {catalogStale && (
          <p class="text-warning mt-3 text-xs">
            Showing a cached model catalog.
          </p>
        )}
        {modelError && <p class="text-error mt-3 text-xs">{modelError}</p>}
        <div class="mt-3">
          <p class="text-base-content/50 mb-2 text-xs font-medium">
            {visibleModels.length} available model
            {visibleModels.length === 1 ? "" : "s"}
          </p>
          {visibleModels.length === 0 ? (
            <p class="text-base-content/50 rounded-box border-base-300 border px-3 py-4 text-sm">
              No available models found.
            </p>
          ) : (
            <ul class="max-h-72 space-y-2 overflow-y-auto pr-1">
              {visibleModels.map((model) => (
                <li key={`${model.providerId}:${model.modelId}`}>
                  <button
                    class="btn h-auto min-h-0 w-full justify-start px-3 py-2.5 text-left whitespace-normal"
                    type="button"
                    disabled={draft.models.length >= 3}
                    onClick={() => onToggleModel(model)}
                  >
                    <span class="min-w-0 grow">
                      <span class="block truncate text-sm font-medium">
                        {model.name}
                      </span>
                      <span class="text-base-content/50 block truncate text-xs font-normal">
                        {model.description ?? model.modelId}
                      </span>
                    </span>
                    <span class="badge badge-ghost badge-sm shrink-0">Add</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section
        class="border-base-300 mt-7 border-t pt-5"
        aria-labelledby="generation-heading"
      >
        <h3 id="generation-heading" class="font-semibold">
          Generation
        </h3>
        <div class="mt-4 grid gap-5">
          <fieldset>
            <legend class="text-xs font-semibold">Resolution</legend>
            <div class="mt-2 grid grid-cols-4 gap-1.5">
              {(["512", "1K", "2K", "4K"] as const).map((resolution) => (
                <button
                  key={resolution}
                  class={`btn btn-sm ${draft.resolution === resolution ? "btn-active" : "btn-outline"}`}
                  type="button"
                  aria-pressed={draft.resolution === resolution}
                  onClick={() => onDraftChange({ ...draft, resolution })}
                >
                  {resolution}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend class="text-xs font-semibold">Aspect ratio</legend>
            <div class="mt-2 grid grid-cols-3 gap-1.5">
              {(
                ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const
              ).map((aspectRatio) => (
                <button
                  key={aspectRatio}
                  class={`btn btn-sm ${draft.aspectRatio === aspectRatio ? "btn-active" : "btn-outline"}`}
                  type="button"
                  aria-pressed={draft.aspectRatio === aspectRatio}
                  onClick={() => onDraftChange({ ...draft, aspectRatio })}
                >
                  {aspectRatio}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend class="text-xs font-semibold">Images per model</legend>
            <div class="join mt-2 flex w-full">
              <button
                class="btn join-item btn-sm"
                type="button"
                disabled={draft.count <= 1}
                onClick={() =>
                  onDraftChange({ ...draft, count: draft.count - 1 })
                }
                aria-label="Decrease images per model"
              >
                -
              </button>
              <output
                class="input join-item input-sm flex min-w-0 grow items-center justify-center text-center font-medium"
                aria-live="polite"
              >
                {draft.count}
              </output>
              <button
                class="btn join-item btn-sm"
                type="button"
                disabled={draft.count >= 10}
                onClick={() =>
                  onDraftChange({ ...draft, count: draft.count + 1 })
                }
                aria-label="Increase images per model"
              >
                +
              </button>
            </div>
          </fieldset>
        </div>
      </section>
      <details class="collapse collapse-arrow border-base-300 mt-7 border-t">
        <summary class="collapse-title px-0 py-4 text-sm font-semibold">
          Output settings
        </summary>
        <div class="collapse-content px-0 pb-1">
          <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
            <label class="grid gap-2 text-xs font-semibold">
              Quality
              <select
                class="select select-sm w-full font-normal"
                value={draft.quality ?? ""}
                onChange={(event) =>
                  event.currentTarget.value
                    ? onDraftChange({
                        ...draft,
                        quality: event.currentTarget.value as NonNullable<
                          SessionDraft["quality"]
                        >,
                      })
                    : clearOutputOption("quality")
                }
              >
                <option value="">Model default</option>
                <option value="auto">Auto</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label class="grid gap-2 text-xs font-semibold">
              Background
              <select
                class="select select-sm w-full font-normal"
                value={draft.background ?? ""}
                onChange={(event) =>
                  event.currentTarget.value
                    ? onDraftChange({
                        ...draft,
                        background: event.currentTarget.value as NonNullable<
                          SessionDraft["background"]
                        >,
                      })
                    : clearOutputOption("background")
                }
              >
                <option value="">Model default</option>
                <option value="auto">Auto</option>
                <option value="transparent">Transparent</option>
                <option value="opaque">Opaque</option>
              </select>
            </label>
            <label class="grid gap-2 text-xs font-semibold">
              File format
              <select
                class="select select-sm w-full font-normal"
                value={draft.outputFormat ?? ""}
                onChange={(event) =>
                  event.currentTarget.value
                    ? onDraftChange({
                        ...draft,
                        outputFormat: event.currentTarget.value as NonNullable<
                          SessionDraft["outputFormat"]
                        >,
                      })
                    : clearOutputOption("outputFormat")
                }
              >
                <option value="">Model default</option>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
            <label class="grid gap-2 text-xs font-semibold">
              Compression
              <input
                class="input input-sm w-full font-normal"
                type="number"
                min="0"
                max="100"
                value={draft.outputCompression ?? ""}
                placeholder="Model default"
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  if (value) {
                    onDraftChange({
                      ...draft,
                      outputCompression: Number(value),
                    });
                  } else {
                    clearOutputOption("outputCompression");
                  }
                }}
              />
            </label>
          </div>
        </div>
      </details>
      {(referenceLimitErrors.length > 0 || capabilityWarnings.length > 0) && (
        <div class="alert alert-warning mt-7 items-start rounded-box py-3 text-xs leading-5">
          <div>
            {referenceLimitErrors.map((message) => (
              <p key={message}>{message}</p>
            ))}
            {capabilityWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        </div>
      )}
      <div class="border-base-300 text-base-content/50 mt-7 border-t pt-5 text-xs leading-5">
        Autosave enabled
      </div>
    </aside>
  );
}
