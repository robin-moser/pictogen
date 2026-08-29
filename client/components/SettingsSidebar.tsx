import { useState } from "preact/hooks";

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
const squareAspectRatio = "1:1" as const;
const aspectRatioPairs = [
  ["16:9", "9:16"],
  ["3:2", "2:3"],
  ["4:3", "3:4"],
] as const;

const optionButton = "btn h-11 border-base-300 bg-base-100 font-medium";
const optionButtonActive = "btn h-11 btn-primary font-semibold";

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
  const [hint, setHint] = useState<{
    text: string;
    top: number;
    left: number;
  } | null>(null);

  function showHint(anchor: HTMLElement, text: string) {
    const rect = anchor.getBoundingClientRect();
    setHint({
      text,
      left: rect.left - 18,
      top: Math.min(
        Math.max(rect.top + rect.height / 2, 80),
        window.innerHeight - 80,
      ),
    });
  }

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
      <div class="border-base-300 flex shrink-0 items-center justify-between border-b px-5 py-4">
        <h2 id="settings-heading" class="text-sm font-semibold tracking-tight">
          Settings
        </h2>
        <button
          class="btn btn-ghost btn-sm btn-square xl:hidden"
          type="button"
          aria-label="Close settings"
          onClick={onClose}
        >
          <CloseIcon class="size-4" />
        </button>
      </div>

      <div class="scroll-pane grow px-5 py-6">
        <section aria-labelledby="models-heading">
          <div class="mb-3 flex items-baseline justify-between gap-3">
            <h3 id="models-heading" class="field-legend">
              Models
            </h3>
            <span class="text-base-content/40 text-xs tabular-nums">
              {draft.models.length}/3
            </span>
          </div>

          {selectedModels.length > 0 && (
            <ul class="mb-3 flex flex-col gap-2" aria-label="Selected models">
              {selectedModels.map((model) => (
                <li
                  key={`${model.providerId}:${model.modelId}`}
                  class="bg-base-100 border-base-300 rounded-field flex min-h-11 items-center gap-2.5 border py-2 pr-2 pl-3"
                >
                  <span class="bg-primary size-1.5 shrink-0 rounded-full" />
                  <span class="min-w-0 grow">
                    <span class="block truncate text-sm font-medium">
                      {model.name}
                    </span>
                    <span class="text-base-content/40 block truncate text-xs">
                      {model.modelId}
                    </span>
                  </span>
                  <button
                    class="btn btn-ghost btn-sm btn-square shrink-0"
                    type="button"
                    onClick={() => onToggleModel(model)}
                    aria-label={`Remove ${model.name}`}
                    title="Remove"
                  >
                    <CloseIcon class="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label class="input h-11 w-full">
            <SearchIcon class="text-base-content/35 size-4" />
            <input
              type="search"
              value={modelSearch}
              placeholder="Search models"
              aria-label="Search image models"
              onInput={(event) => onModelSearch(event.currentTarget.value)}
            />
          </label>

          {catalogStale && (
            <p class="text-warning mt-2.5 text-xs">Showing a cached catalog.</p>
          )}
          {modelError && <p class="text-error mt-2.5 text-xs">{modelError}</p>}

          {visibleModels.length === 0 ? (
            <p class="text-base-content/40 mt-3 px-1 py-4 text-xs">
              No matching models.
            </p>
          ) : (
            <ul
              class="border-base-300 divide-base-300 rounded-field mt-3 max-h-80 divide-y overflow-y-auto border"
              onScroll={() => setHint(null)}
              onMouseLeave={() => setHint(null)}
            >
              {visibleModels.map((model) => (
                <li
                  key={`${model.providerId}:${model.modelId}`}
                  onMouseEnter={(event) =>
                    showHint(
                      event.currentTarget,
                      modelsFull
                        ? "Three models already selected."
                        : `${model.name}\n${model.providerId} / ${model.modelId}\n${model.description ?? ""}`.trim(),
                    )
                  }
                >
                  <button
                    class="hover:bg-base-300/50 group/model flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-35"
                    type="button"
                    disabled={modelsFull}
                    onClick={() => onToggleModel(model)}
                    onFocus={(event) =>
                      showHint(
                        event.currentTarget,
                        `${model.name}\n${model.providerId} / ${model.modelId}\n${model.description ?? ""}`.trim(),
                      )
                    }
                    onBlur={() => setHint(null)}
                  >
                    <span class="min-w-0 grow">
                      <span class="block truncate text-sm font-medium">
                        {model.name}
                      </span>
                      <span class="text-base-content/45 mt-0.5 block truncate text-xs leading-5">
                        {model.description ?? model.modelId}
                      </span>
                    </span>
                    <PlusIcon class="text-base-content/30 group-hover/model:text-base-content mt-0.5 size-4 shrink-0 transition-colors" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          class="border-base-300 mt-8 border-t pt-6"
          aria-labelledby="generation-heading"
        >
          <h3 id="generation-heading" class="field-legend">
            Generation
          </h3>

          <fieldset class="mt-4">
            <legend class="text-base-content/55 mb-2 text-xs font-medium">
              Resolution
            </legend>
            <div class="grid grid-cols-4 gap-2">
              {resolutions.map((resolution) => (
                <button
                  key={resolution}
                  class={
                    draft.resolution === resolution
                      ? optionButtonActive
                      : optionButton
                  }
                  type="button"
                  aria-pressed={draft.resolution === resolution}
                  onClick={() => onDraftChange({ ...draft, resolution })}
                >
                  {resolution}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset class="mt-5">
            <legend class="text-base-content/55 mb-2 text-xs font-medium">
              Aspect ratio
            </legend>
            <div class="grid grid-cols-2 gap-2">
              <button
                class={`col-span-2 ${
                  draft.aspectRatio === squareAspectRatio
                    ? optionButtonActive
                    : optionButton
                }`}
                type="button"
                aria-pressed={draft.aspectRatio === squareAspectRatio}
                onClick={() =>
                  onDraftChange({ ...draft, aspectRatio: squareAspectRatio })
                }
              >
                {squareAspectRatio}
              </button>

              <span
                class="text-base-content/35 mt-1 text-center text-[0.68rem] font-medium"
                aria-hidden="true"
              >
                Landscape
              </span>
              <span
                class="text-base-content/35 mt-1 text-center text-[0.68rem] font-medium"
                aria-hidden="true"
              >
                Portrait
              </span>

              {aspectRatioPairs.flat().map((aspectRatio) => (
                <button
                  key={aspectRatio}
                  class={
                    draft.aspectRatio === aspectRatio
                      ? optionButtonActive
                      : optionButton
                  }
                  type="button"
                  aria-pressed={draft.aspectRatio === aspectRatio}
                  onClick={() => onDraftChange({ ...draft, aspectRatio })}
                >
                  {aspectRatio}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset class="mt-5">
            <legend class="text-base-content/55 mb-2 text-xs font-medium">
              Images per model
            </legend>
            <div class="flex items-stretch gap-2">
              <button
                class="btn border-base-300 bg-base-100 h-11 w-14 shrink-0 text-lg"
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
                class="bg-base-100 border-base-300 rounded-field flex h-11 min-w-0 grow items-center justify-center border text-sm font-semibold tabular-nums"
                aria-live="polite"
              >
                {draft.count}
              </output>
              <button
                class="btn border-base-300 bg-base-100 h-11 w-14 shrink-0 text-lg"
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

        <details class="border-base-300 mt-8 border-t">
          <summary class="field-legend hover:text-base-content/70 marker:text-base-content/30 cursor-pointer py-4 transition-colors">
            Output
          </summary>
          <div class="grid gap-4 pb-2">
            <label class="grid gap-2">
              <span class="text-base-content/55 text-xs font-medium">
                Quality
              </span>
              <select
                class="select border-base-300 bg-base-100 h-11 w-full"
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

            <label class="grid gap-2">
              <span class="text-base-content/55 text-xs font-medium">
                Background
              </span>
              <select
                class="select border-base-300 bg-base-100 h-11 w-full"
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

            <label class="grid gap-2">
              <span class="text-base-content/55 text-xs font-medium">
                File format
              </span>
              <select
                class="select border-base-300 bg-base-100 h-11 w-full"
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

            <label class="grid gap-2">
              <span class="text-base-content/55 text-xs font-medium">
                Compression
              </span>
              <input
                class="input border-base-300 bg-base-100 h-11 w-full"
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
          <div class="bg-warning/10 text-warning rounded-field mt-6 flex gap-2.5 p-3 text-xs leading-5">
            <AlertIcon class="mt-0.5 size-4 shrink-0" />
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

      {hint && (
        <div
          class="bg-base-300 border-base-content/10 rounded-field pointer-events-none fixed z-50 max-w-80 border px-3 py-2 text-xs leading-5 whitespace-pre-line shadow-lg"
          style={{
            left: `${hint.left}px`,
            top: `${hint.top}px`,
            transform: "translate(-100%, -50%)",
          }}
          role="tooltip"
        >
          {hint.text}
        </div>
      )}
    </div>
  );
}
