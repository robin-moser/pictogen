import type { ImageModel, SessionDraft } from "../../shared/contracts.js";
import { resolveEffectiveOptions } from "../../shared/capabilities.js";
import { AlertIcon, CloseIcon, PlusIcon, SearchIcon } from "./Icons.js";

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
  onClose: () => void;
};

const resolutions = ["512", "1K", "2K", "4K"] as const;
const aspectRatios = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
] as const;

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
  onClose,
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
  const modelsFull = draft.models.length >= 3;

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
    <div
      class="bg-base-200 flex h-full min-h-0 flex-col"
      aria-labelledby="settings-heading"
    >
      <div class="border-base-300 flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h2 id="settings-heading" class="text-sm font-semibold tracking-tight">
          Settings
        </h2>
        <button
          class="btn btn-ghost btn-xs btn-square xl:hidden"
          type="button"
          aria-label="Close settings"
          onClick={onClose}
        >
          <CloseIcon class="size-4" />
        </button>
      </div>

      <div class="scroll-pane grow px-4 py-4">
        <section aria-labelledby="models-heading">
          <div class="flex items-baseline justify-between gap-3">
            <h3 id="models-heading" class="field-legend">
              Models
            </h3>
            <span class="text-base-content/40 text-xs tabular-nums">
              {draft.models.length}/3
            </span>
          </div>

          {selectedModels.length > 0 && (
            <ul class="mt-2.5 flex flex-col gap-1" aria-label="Selected models">
              {selectedModels.map((model) => (
                <li
                  key={`${model.providerId}:${model.modelId}`}
                  class="bg-base-100 border-base-300 rounded-field flex items-center gap-2 border py-1.5 pr-1.5 pl-2.5"
                >
                  <span class="bg-primary size-1.5 shrink-0 rounded-full" />
                  <span class="min-w-0 grow">
                    <span class="block truncate text-xs font-medium">
                      {model.name}
                    </span>
                    <span class="text-base-content/40 block truncate text-[0.68rem]">
                      {model.modelId}
                    </span>
                  </span>
                  <button
                    class="btn btn-ghost btn-xs btn-square shrink-0"
                    type="button"
                    onClick={() => onToggleModel(model)}
                    aria-label={`Remove ${model.name}`}
                    title="Remove"
                  >
                    <CloseIcon class="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label class="input input-sm mt-2.5 w-full">
            <SearchIcon class="text-base-content/35 size-3.5" />
            <input
              type="search"
              value={modelSearch}
              placeholder="Search models"
              aria-label="Search image models"
              onInput={(event) => onModelSearch(event.currentTarget.value)}
            />
          </label>

          {catalogStale && (
            <p class="text-warning mt-2 text-xs">Showing a cached catalog.</p>
          )}
          {modelError && <p class="text-error mt-2 text-xs">{modelError}</p>}

          {visibleModels.length === 0 ? (
            <p class="text-base-content/40 mt-2.5 px-1 py-3 text-xs">
              No matching models.
            </p>
          ) : (
            <ul class="border-base-300 rounded-field mt-2.5 max-h-64 divide-y divide-base-300 overflow-y-auto border">
              {visibleModels.map((model) => (
                <li key={`${model.providerId}:${model.modelId}`}>
                  <button
                    class="hover:bg-base-300/50 group/model flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-35"
                    type="button"
                    disabled={modelsFull}
                    title={
                      modelsFull ? "Three models already selected" : undefined
                    }
                    onClick={() => onToggleModel(model)}
                  >
                    <span class="min-w-0 grow">
                      <span class="block truncate text-xs font-medium">
                        {model.name}
                      </span>
                      <span class="text-base-content/40 block truncate text-[0.68rem]">
                        {model.description ?? model.modelId}
                      </span>
                    </span>
                    <PlusIcon class="text-base-content/30 group-hover/model:text-primary size-3.5 shrink-0 transition-colors" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          class="border-base-300 mt-6 border-t pt-4"
          aria-labelledby="generation-heading"
        >
          <h3 id="generation-heading" class="field-legend">
            Generation
          </h3>

          <fieldset class="mt-3">
            <legend class="text-base-content/60 mb-1.5 text-xs font-medium">
              Resolution
            </legend>
            <div class="join w-full">
              {resolutions.map((resolution) => (
                <button
                  key={resolution}
                  class={`btn btn-xs join-item flex-1 ${
                    draft.resolution === resolution
                      ? "btn-primary"
                      : "bg-base-100"
                  }`}
                  type="button"
                  aria-pressed={draft.resolution === resolution}
                  onClick={() => onDraftChange({ ...draft, resolution })}
                >
                  {resolution}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset class="mt-3.5">
            <legend class="text-base-content/60 mb-1.5 text-xs font-medium">
              Aspect ratio
            </legend>
            <div class="grid grid-cols-4 gap-1">
              {aspectRatios.map((aspectRatio) => (
                <button
                  key={aspectRatio}
                  class={`btn btn-xs ${
                    draft.aspectRatio === aspectRatio
                      ? "btn-primary"
                      : "bg-base-100"
                  }`}
                  type="button"
                  aria-pressed={draft.aspectRatio === aspectRatio}
                  onClick={() => onDraftChange({ ...draft, aspectRatio })}
                >
                  {aspectRatio}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset class="mt-3.5">
            <legend class="text-base-content/60 mb-1.5 text-xs font-medium">
              Images per model
            </legend>
            <div class="join flex w-full">
              <button
                class="btn btn-xs join-item bg-base-100"
                type="button"
                disabled={draft.count <= 1}
                onClick={() =>
                  onDraftChange({ ...draft, count: draft.count - 1 })
                }
                aria-label="Decrease images per model"
              >
                −
              </button>
              <output
                class="bg-base-100 border-base-300 join-item flex min-w-0 grow items-center justify-center border-y text-xs font-medium tabular-nums"
                aria-live="polite"
              >
                {draft.count}
              </output>
              <button
                class="btn btn-xs join-item bg-base-100"
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
        </section>

        <details class="border-base-300 mt-6 border-t">
          <summary class="text-base-content/60 hover:text-base-content marker:text-base-content/30 cursor-pointer py-3 text-xs font-semibold tracking-[0.06em] uppercase transition-colors">
            Output
          </summary>
          <div class="grid gap-3 pb-2">
            <label class="grid gap-1.5">
              <span class="text-base-content/60 text-xs font-medium">
                Quality
              </span>
              <select
                class="select select-xs bg-base-100 w-full"
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

            <label class="grid gap-1.5">
              <span class="text-base-content/60 text-xs font-medium">
                Background
              </span>
              <select
                class="select select-xs bg-base-100 w-full"
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

            <label class="grid gap-1.5">
              <span class="text-base-content/60 text-xs font-medium">
                File format
              </span>
              <select
                class="select select-xs bg-base-100 w-full"
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

            <label class="grid gap-1.5">
              <span class="text-base-content/60 text-xs font-medium">
                Compression
              </span>
              <input
                class="input input-xs bg-base-100 w-full"
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
        </details>

        {(referenceLimitErrors.length > 0 || capabilityWarnings.length > 0) && (
          <div class="bg-warning/10 text-warning rounded-field mt-5 flex gap-2 p-2.5 text-xs leading-5">
            <AlertIcon class="mt-0.5 size-3.5 shrink-0" />
            <div class="min-w-0">
              {referenceLimitErrors.map((message) => (
                <p key={message}>{message}</p>
              ))}
              {capabilityWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
