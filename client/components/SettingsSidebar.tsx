import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { ImageModel, SessionDraft } from "../../shared/contracts.js";
import { resolveEffectiveOptions } from "../../shared/capabilities.js";
import {
  AlertIcon,
  ChevronRightIcon,
  CloseIcon,
  PlusIcon,
  SearchIcon,
} from "./Icons.js";

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

type ModelSort = "name" | "release-date" | "pricing" | `design-arena:${string}`;
type HintTarget = { anchor: HTMLElement; model: ImageModel };

const resolutions = ["512", "1K", "2K", "4K"] as const;
const squareAspectRatio = "1:1" as const;
const landscapeAspectRatios = ["16:9", "3:2", "4:3"] as const;
const portraitAspectRatios = ["9:16", "2:3", "3:4"] as const;

const optionButton = "btn border-base-300 bg-base-100 font-medium";
const optionButtonActive = "btn btn-primary font-semibold";
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const priceFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 3,
});

function formatCategory(category: string) {
  return category
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function modelPrice(model: ImageModel) {
  // An effective per-image price is comparable across models; the token rates
  // some image models report instead are not.
  const perImage = model.displayPricing?.find(
    (entry) => entry.unit === "/image",
  );
  return perImage?.price;
}

function modelReleaseTime(model: ImageModel) {
  if (!model.releasedAt) {
    return undefined;
  }
  const timestamp = Date.parse(model.releasedAt);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function designArenaRank(model: ImageModel, category: string) {
  return model.benchmarks?.designArena?.find(
    (benchmark) => benchmark.category === category,
  )?.rank;
}

function compareNumber(
  left: number | undefined,
  right: number | undefined,
  direction: "ascending" | "descending" = "ascending",
) {
  if (left === undefined) {
    return right === undefined ? 0 : 1;
  }
  if (right === undefined) {
    return -1;
  }
  return direction === "ascending" ? left - right : right - left;
}

export function compareImageModels(
  left: ImageModel,
  right: ImageModel,
  modelSort: ModelSort,
) {
  const compareName = () => left.name.localeCompare(right.name);
  const benchmarkCategory = modelSort.startsWith("design-arena:")
    ? modelSort.slice("design-arena:".length)
    : undefined;
  switch (modelSort) {
    case "release-date":
      return (
        compareNumber(
          modelReleaseTime(left),
          modelReleaseTime(right),
          "descending",
        ) || compareName()
      );
    case "pricing":
      return modelPrice(left) === modelPrice(right)
        ? compareName()
        : compareNumber(modelPrice(left), modelPrice(right));
    case "name":
      return compareName();
    default:
      return (
        compareNumber(
          designArenaRank(left, benchmarkCategory ?? ""),
          designArenaRank(right, benchmarkCategory ?? ""),
        ) || compareName()
      );
  }
}

export function placeModelHint(
  anchor: { left: number; right: number; top: number; height: number },
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const margin = 16;
  const gap = 12;
  const maximumLeft = Math.max(margin, viewport.width - popover.width - margin);
  const viewportMaxHeight = Math.max(0, viewport.height - margin * 2);
  const effectiveHeight = Math.min(popover.height, viewportMaxHeight);
  const fitsLeft = anchor.left - gap - popover.width >= margin;
  const fitsRight =
    anchor.right + gap + popover.width <= viewport.width - margin;

  if (fitsLeft || fitsRight) {
    const left = fitsLeft
      ? anchor.left - gap - popover.width
      : anchor.right + gap;
    const maximumTop = Math.max(
      margin,
      viewport.height - effectiveHeight - margin,
    );
    const centeredTop = anchor.top + anchor.height / 2 - effectiveHeight / 2;
    return {
      left: Math.min(Math.max(left, margin), maximumLeft),
      top: Math.min(Math.max(centeredTop, margin), maximumTop),
      maxHeight: viewportMaxHeight,
    };
  }

  const aboveSpace = Math.max(0, anchor.top - gap - margin);
  const belowTop = anchor.top + anchor.height + gap;
  const belowSpace = Math.max(0, viewport.height - margin - belowTop);
  const placeAbove = aboveSpace >= belowSpace;
  const maxHeight = placeAbove ? aboveSpace : belowSpace;
  const verticalHeight = Math.min(popover.height, maxHeight);
  return {
    left: Math.min(
      Math.max(
        anchor.left + (anchor.right - anchor.left) / 2 - popover.width / 2,
        margin,
      ),
      maximumLeft,
    ),
    top: placeAbove ? anchor.top - gap - verticalHeight : belowTop,
    maxHeight,
  };
}

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
  const [modelSort, setModelSort] = useState<ModelSort>("name");
  const [hint, setHint] = useState<{
    model: ImageModel;
    anchor: { left: number; right: number; top: number; height: number };
  } | null>(null);
  const [hintPosition, setHintPosition] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);
  const hintElement = useRef<HTMLDivElement>(null);
  const focusedHint = useRef<HintTarget | null>(null);
  const hoveredHint = useRef<HintTarget | null>(null);
  const hideHintTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintHovered = useRef(false);

  useLayoutEffect(() => {
    if (!hint || !hintElement.current) return;
    const bounds = hintElement.current.getBoundingClientRect();
    setHintPosition(
      placeModelHint(hint.anchor, bounds, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, [hint]);

  useEffect(() => {
    return () => {
      if (hideHintTimeout.current) clearTimeout(hideHintTimeout.current);
    };
  }, []);
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
  const designArenaCategories = [
    ...new Set(
      models.flatMap(
        (model) =>
          model.benchmarks?.designArena?.map(
            (benchmark) => benchmark.category,
          ) ?? [],
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const sortOptions: Array<{ value: ModelSort; label: string }> = [
    { value: "name", label: "Name" },
    { value: "release-date", label: "Release date" },
    { value: "pricing", label: "Pricing" },
    ...designArenaCategories.map((category) => ({
      value: `design-arena:${category}` as ModelSort,
      label: `Rank ${formatCategory(category)}`,
    })),
  ];
  const activeModelSort = sortOptions.some(
    (option) => option.value === modelSort,
  )
    ? modelSort
    : "name";
  const selectedSort = sortOptions.find(
    (option) => option.value === activeModelSort,
  ) ?? {
    value: "name" as const,
    label: "Name",
  };
  const visibleModels = availableModels
    .filter((model) =>
      [model.providerId, model.modelId, model.name, model.description]
        .filter((value): value is string => Boolean(value))
        .some((value) =>
          value
            .toLocaleLowerCase()
            .includes(modelSearch.trim().toLocaleLowerCase()),
        ),
    )
    .sort((left, right) => compareImageModels(left, right, activeModelSort));
  const capabilityWarnings = selectedModels.flatMap((model) =>
    resolveEffectiveOptions(model, draft).changes.map(
      (change) => `${model.name}: ${change}.`,
    ),
  );

  function cancelHideHint() {
    if (!hideHintTimeout.current) return;
    clearTimeout(hideHintTimeout.current);
    hideHintTimeout.current = null;
  }

  function hideHint() {
    cancelHideHint();
    hintHovered.current = false;
    focusedHint.current = null;
    hoveredHint.current = null;
    setHint(null);
    setHintPosition(null);
  }

  function displayHint({ anchor, model }: HintTarget) {
    cancelHideHint();
    const bounds = anchor.getBoundingClientRect();
    setHintPosition(null);
    setHint({
      model,
      anchor: {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        height: bounds.height,
      },
    });
  }

  function scheduleHintUpdate(clearHovered = false) {
    cancelHideHint();
    if (clearHovered) hoveredHint.current = null;
    hideHintTimeout.current = setTimeout(() => {
      if (hintHovered.current) return;
      const focused = focusedHint.current;
      if (focused?.anchor.contains(document.activeElement)) {
        displayHint(focused);
        return;
      }
      const hovered = hoveredHint.current;
      if (hovered) {
        displayHint(hovered);
        return;
      }
      hideHint();
    }, 300);
  }

  function showHoveredHint(anchor: HTMLElement, model: ImageModel) {
    hoveredHint.current = { anchor, model };
    displayHint(hoveredHint.current);
  }

  function showFocusedHint(anchor: HTMLElement, model: ImageModel) {
    focusedHint.current = { anchor, model };
    displayHint(focusedHint.current);
  }

  function clearFocusedHint(anchor: HTMLElement) {
    if (focusedHint.current?.anchor === anchor) focusedHint.current = null;
    scheduleHintUpdate();
  }

  function handleHintKeyDown(event: KeyboardEvent) {
    const element = hintElement.current;
    if (!element) return;
    const page = element.clientHeight * 0.8;
    const canScrollUp = element.scrollTop > 0;
    const canScrollDown =
      element.scrollTop < element.scrollHeight - element.clientHeight;
    switch (event.key) {
      case "ArrowDown":
        if (!canScrollDown) return;
        element.scrollBy({ top: 40 });
        break;
      case "ArrowUp":
        if (!canScrollUp) return;
        element.scrollBy({ top: -40 });
        break;
      case "PageDown":
        if (!canScrollDown) return;
        element.scrollBy({ top: page });
        break;
      case "PageUp":
        if (!canScrollUp) return;
        element.scrollBy({ top: -page });
        break;
      case "Home":
        if (!canScrollUp) return;
        element.scrollTo({ top: 0 });
        break;
      case "End":
        if (!canScrollDown) return;
        element.scrollTo({ top: element.scrollHeight });
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  useEffect(() => {
    if (!hint) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      hideHint();
    };
    const onViewportChange = (event: Event) => {
      if (
        event.target instanceof Node &&
        hintElement.current?.contains(event.target)
      ) {
        return;
      }
      hideHint();
    };
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
    };
  }, [hint]);

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
      <div class="border-base-300 flex shrink-0 items-center justify-between border-b px-6 py-5">
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
        <button
          class="btn btn-ghost btn-sm btn-square hidden xl:inline-flex"
          type="button"
          aria-label="Collapse settings"
          title="Collapse settings"
          onClick={onClose}
        >
          <ChevronRightIcon class="size-4" />
        </button>
      </div>

      <div class="scroll-pane grow px-6 py-7">
        <section aria-labelledby="models-heading">
          <div class="mb-3 flex items-center justify-between gap-3">
            <h3 id="models-heading" class="field-legend">
              Models
            </h3>
            <div class="flex items-center gap-2">
              <span class="text-base-content/40 text-xs tabular-nums">
                {draft.models.length}
              </span>
              <details class="dropdown dropdown-end">
                <summary class="btn btn-ghost btn-xs list-none gap-1 px-2 text-xs font-medium">
                  Sort: {selectedSort.label}
                </summary>
                <ul class="menu bg-base-100 border-base-300 dropdown-content z-50 mt-2 w-60 rounded-field border p-1 shadow-lg">
                  {sortOptions.map((option) => (
                    <li key={option.value}>
                      <button
                        class={
                          option.value === activeModelSort
                            ? "menu-active"
                            : undefined
                        }
                        type="button"
                        onClick={(event) => {
                          hideHint();
                          setModelSort(option.value);
                          event.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                        }}
                      >
                        {option.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          </div>

          {selectedModels.length > 0 && (
            <ul class="mb-3 flex flex-col gap-2" aria-label="Selected models">
              {selectedModels.map((model) => (
                <li
                  key={`${model.providerId}:${model.modelId}`}
                  class="bg-base-100 border-base-300 rounded-field flex min-h-11 items-center gap-2.5 border py-2 pr-2 pl-3"
                  onMouseEnter={(event) =>
                    showHoveredHint(event.currentTarget, model)
                  }
                  onMouseLeave={() => scheduleHintUpdate(true)}
                >
                  <span class="bg-primary size-1.5 shrink-0 rounded-full" />
                  <span
                    class="min-w-0 grow outline-none focus-visible:underline"
                    tabIndex={0}
                    aria-label={`${model.name} details`}
                    aria-describedby={
                      hint?.model.providerId === model.providerId &&
                      hint.model.modelId === model.modelId
                        ? "model-details-popover"
                        : undefined
                    }
                    onFocus={(event) =>
                      showFocusedHint(event.currentTarget, model)
                    }
                    onBlur={(event) => clearFocusedHint(event.currentTarget)}
                    onKeyDown={handleHintKeyDown}
                  >
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
                    onClick={() => {
                      hideHint();
                      onToggleModel(model);
                    }}
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
              onScroll={hideHint}
              onMouseLeave={() => scheduleHintUpdate(true)}
            >
              {visibleModels.map((model) => (
                <li
                  key={`${model.providerId}:${model.modelId}`}
                  class="hover:bg-base-300/50 flex items-center transition-colors"
                  onMouseEnter={(event) =>
                    showHoveredHint(event.currentTarget, model)
                  }
                >
                  <button
                    class="group/model flex w-full min-w-0 items-start gap-2.5 px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-35"
                    type="button"
                    onClick={() => {
                      hideHint();
                      onToggleModel(model);
                    }}
                    aria-label={`Add ${model.name}`}
                    aria-describedby={
                      hint?.model.providerId === model.providerId &&
                      hint.model.modelId === model.modelId
                        ? "model-details-popover"
                        : undefined
                    }
                    onFocus={(event) =>
                      showFocusedHint(event.currentTarget, model)
                    }
                    onBlur={(event) => clearFocusedHint(event.currentTarget)}
                    onKeyDown={handleHintKeyDown}
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
                  class={`h-11 ${
                    draft.resolution === resolution
                      ? optionButtonActive
                      : optionButton
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

          <fieldset class="mt-5">
            <legend class="text-base-content/55 mb-2 text-xs font-medium">
              Aspect ratio
            </legend>
            <div class="grid grid-cols-4 grid-rows-2 gap-2">
              <button
                class={`row-span-2 h-full ${
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

              {[...landscapeAspectRatios, ...portraitAspectRatios].map(
                (aspectRatio) => (
                  <button
                    key={aspectRatio}
                    class={`h-11 ${
                      draft.aspectRatio === aspectRatio
                        ? optionButtonActive
                        : optionButton
                    }`}
                    type="button"
                    aria-pressed={draft.aspectRatio === aspectRatio}
                    onClick={() => onDraftChange({ ...draft, aspectRatio })}
                  >
                    {aspectRatio}
                  </button>
                ),
              )}
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

      {hint &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={hintElement}
            id="model-details-popover"
            class="bg-base-100 border-base-content/10 rounded-field fixed z-50 max-h-[calc(100dvh-2rem)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto border p-4 text-xs leading-5 shadow-xl"
            style={{
              left: `${hintPosition?.left ?? 0}px`,
              top: `${hintPosition?.top ?? 0}px`,
              maxHeight: hintPosition
                ? `${hintPosition.maxHeight}px`
                : undefined,
              visibility: hintPosition ? "visible" : "hidden",
            }}
            role="tooltip"
            onMouseEnter={() => {
              hintHovered.current = true;
              cancelHideHint();
            }}
            onMouseLeave={() => {
              hintHovered.current = false;
              scheduleHintUpdate(true);
            }}
          >
            <p class="text-sm font-semibold">{hint.model.name}</p>
            <p class="text-base-content/50 mt-0.5 break-all font-mono text-[11px]">
              {hint.model.providerId} / {hint.model.modelId}
            </p>
            {hint.model.description && (
              <p class="text-base-content/70 mt-3 whitespace-pre-line">
                {hint.model.description}
              </p>
            )}

            {(hint.model.releasedAt || hint.model.displayPricing) && (
              <dl class="border-base-300 mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3">
                {hint.model.releasedAt && (
                  <div>
                    <dt class="text-base-content/45 text-[11px] font-medium tracking-wide uppercase">
                      Release date
                    </dt>
                    <dd class="mt-0.5 tabular-nums">
                      {dateFormatter.format(new Date(hint.model.releasedAt))}
                    </dd>
                  </div>
                )}
                {hint.model.displayPricing && (
                  <div>
                    <dt class="text-base-content/45 text-[11px] font-medium tracking-wide uppercase">
                      Pricing
                    </dt>
                    <dd class="mt-0.5 space-y-0.5 tabular-nums">
                      {hint.model.displayPricing.map((entry, index) => (
                        <span
                          class="block"
                          key={`${entry.label}${entry.unit}${index}`}
                        >
                          {entry.label} {priceFormatter.format(entry.price)}
                          {entry.unit}
                        </span>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {Boolean(hint.model.benchmarks?.designArena?.length) && (
              <div class="border-base-300 mt-4 border-t pt-3">
                <p class="text-base-content/45 text-[11px] font-medium tracking-wide uppercase">
                  Design Arena
                </p>
                <dl class="mt-1 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {[...(hint.model.benchmarks?.designArena ?? [])]
                    .sort((left, right) =>
                      left.category.localeCompare(right.category),
                    )
                    .map((benchmark) => (
                      <div
                        class="flex justify-between gap-2"
                        key={benchmark.category}
                      >
                        <dt class="text-base-content/70 truncate">
                          {formatCategory(benchmark.category)}
                        </dt>
                        <dd class="font-medium tabular-nums">
                          #{benchmark.rank}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
