import type { ImageModel, SessionDraft } from "../../shared/contracts.js";
import { resolveEffectiveOptions } from "../../shared/capabilities.js";
import { Fragment } from "preact/jsx-runtime";
import { useRef } from "preact/hooks";
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
  const modelDropdown = useRef<HTMLDetailsElement>(null);
  const selected = new Set(
    draft.models.map((model) => `${model.providerId}:${model.modelId}`),
  );
  const visible = models.filter((model) =>
    [model.providerId, model.modelId, model.name, model.description]
      .filter((value): value is string => Boolean(value))
      .some((value) =>
        value
          .toLocaleLowerCase()
          .includes(modelSearch.trim().toLocaleLowerCase()),
      ),
  );
  const selectedModels = models.filter((model) =>
    selected.has(`${model.providerId}:${model.modelId}`),
  );
  const availableVisible = visible.filter(
    (model) => !selected.has(`${model.providerId}:${model.modelId}`),
  );
  const capabilityWarnings = selectedModels.flatMap((model) =>
    resolveEffectiveOptions(model, draft).changes.map(
      (change) => `${model.name}: ${change}.`,
    ),
  );
  return (
    <aside
      class="border-base-300 min-h-full border-y-0 border-r-0 bg-base-300 p-5 shadow-none lg:border-l"
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
        aria-labelledby="output-heading"
      >
        <h3 id="output-heading" class="font-semibold">
          Output
        </h3>
        <div class="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
          <label class="grid gap-2 text-xs font-semibold">
            Quality
            <select
              class="select w-full font-normal"
              value={draft.quality ?? ""}
              onChange={(event) =>
                event.currentTarget.value
                  ? onDraftChange({
                      ...draft,
                      quality: event.currentTarget.value as NonNullable<
                        SessionDraft["quality"]
                      >,
                    })
                  : (() => {
                      const { quality: _, ...nextDraft } = draft;
                      onDraftChange(nextDraft);
                    })()
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
              class="select w-full font-normal"
              value={draft.background ?? ""}
              onChange={(event) =>
                event.currentTarget.value
                  ? onDraftChange({
                      ...draft,
                      background: event.currentTarget.value as NonNullable<
                        SessionDraft["background"]
                      >,
                    })
                  : (() => {
                      const { background: _, ...nextDraft } = draft;
                      onDraftChange(nextDraft);
                    })()
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
              class="select w-full font-normal"
              value={draft.outputFormat ?? ""}
              onChange={(event) =>
                event.currentTarget.value
                  ? onDraftChange({
                      ...draft,
                      outputFormat: event.currentTarget.value as NonNullable<
                        SessionDraft["outputFormat"]
                      >,
                    })
                  : (() => {
                      const { outputFormat: _, ...nextDraft } = draft;
                      onDraftChange(nextDraft);
                    })()
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
              class="input w-full font-normal"
              type="number"
              min="0"
              max="100"
              value={draft.outputCompression ?? ""}
              placeholder="Model default"
              onInput={(event) => {
                const value = event.currentTarget.value;
                if (value) {
                  onDraftChange({ ...draft, outputCompression: Number(value) });
                } else {
                  const { outputCompression: _, ...nextDraft } = draft;
                  onDraftChange(nextDraft);
                }
              }}
            />
          </label>
        </div>
      </section>
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
          onInput={(event) => {
            onModelSearch(event.currentTarget.value);
            if (event.currentTarget.value.trim()) {
              modelDropdown.current?.setAttribute("open", "");
            }
          }}
        />
        {catalogStale && (
          <p class="text-warning mt-3 text-xs">
            Showing a cached model catalog.
          </p>
        )}
        {modelError && <p class="text-error mt-3 text-xs">{modelError}</p>}
        {visible.length === 0 ? (
          <p class="text-base-content/50 mt-3 px-3 py-4 text-sm">
            No models found.
          </p>
        ) : (
          <details ref={modelDropdown} class="dropdown mt-3 w-full">
            <summary
              class="select flex w-full cursor-pointer list-none items-center font-normal"
              aria-label="Add or remove image model"
            >
              Choose a model
            </summary>
            <ul
              tabIndex={-1}
              class="dropdown-content menu bg-base-100 rounded-box z-10 mt-1 max-h-64 w-full flex-nowrap overflow-y-auto p-2 shadow"
            >
              {[...selectedModels, ...availableVisible].map((model, index) => {
                const isSelected = selected.has(
                  `${model.providerId}:${model.modelId}`,
                );
                return (
                  <Fragment key={`${model.providerId}:${model.modelId}`}>
                    {index === selectedModels.length &&
                      availableVisible.length > 0 && (
                        <li role="separator" class="divider my-1 h-px" />
                      )}
                    <li>
                      <button
                        type="button"
                        disabled={!isSelected && draft.models.length >= 3}
                        onClick={() => onToggleModel(model)}
                      >
                        <span class="truncate">{model.name}</span>
                        {isSelected && <span>Selected</span>}
                      </button>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </details>
        )}
      </section>
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
