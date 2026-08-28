import type { ImageModel, SessionDraft } from "../../shared/contracts.js";
import { Fragment } from "preact/jsx-runtime";
import { useRef } from "preact/hooks";
type Props = {
  draft: SessionDraft;
  models: ImageModel[];
  modelSearch: string;
  catalogStale: boolean;
  modelError: string | null;
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
  const selectedVisible = visible.filter((model) =>
    selected.has(`${model.providerId}:${model.modelId}`),
  );
  const availableVisible = visible.filter(
    (model) => !selected.has(`${model.providerId}:${model.modelId}`),
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
              {[...selectedVisible, ...availableVisible].map((model, index) => {
                const isSelected = selected.has(
                  `${model.providerId}:${model.modelId}`,
                );
                return (
                  <Fragment key={`${model.providerId}:${model.modelId}`}>
                    {index === selectedVisible.length &&
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
      <div class="border-base-300 text-base-content/50 mt-7 border-t pt-5 text-xs leading-5">
        Autosave enabled
      </div>
    </aside>
  );
}
