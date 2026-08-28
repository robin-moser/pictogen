import type { SessionDetail, SessionDraft } from "../../shared/contracts.js";

type SaveStatus = "saved" | "pending" | "saving" | "error";

type GenerationWorkspaceProps = {
  session: SessionDetail | null;
  draft: SessionDraft;
  saveStatus: SaveStatus;
  onDraftChange: (draft: SessionDraft) => void;
  onClose: () => void;
  onCreate: () => void;
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
}: GenerationWorkspaceProps) {
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
