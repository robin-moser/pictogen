import type { ComponentChildren } from "preact";

import type { SessionDraft } from "../../shared/contracts.js";

const modifierKey =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘"
    : "Ctrl";

export function PromptPanel({
  draft,
  references,
  onDraftChange,
  onGenerate,
  generationBlocked,
  generationBlockMessage,
}: {
  draft: SessionDraft;
  references: ComponentChildren;
  onDraftChange: (draft: SessionDraft) => void;
  onGenerate: () => void;
  generationBlocked: boolean;
  generationBlockMessage: string | undefined;
}) {
  const ready =
    Boolean(draft.prompt.trim()) &&
    draft.models.length > 0 &&
    !generationBlocked;
  const plannedImages = draft.models.length * draft.count;

  return (
    <section class="border-base-300 bg-base-200 focus-within:border-base-content/25 rounded-box flex flex-col overflow-hidden border transition-colors">
      <h2 class="sr-only">Prompt</h2>

      {references}

      <textarea
        class="textarea min-h-32 w-full resize-none rounded-none border-0 bg-transparent px-4 py-3.5 text-[0.95rem] leading-6 focus:outline-none"
        aria-label="Image prompt"
        value={draft.prompt}
        maxLength={12_000}
        placeholder="Describe the image you want to generate…"
        onInput={(event) =>
          onDraftChange({ ...draft, prompt: event.currentTarget.value })
        }
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            if (ready) onGenerate();
          }
        }}
      />

      <div class="border-base-300 flex items-center gap-3 border-t px-3 py-3">
        <span class="text-base-content/35 text-xs tabular-nums">
          {draft.prompt.length.toLocaleString()}
        </span>

        <span class="text-base-content/45 hidden text-xs sm:block">
          {draft.models.length === 0
            ? "No model selected"
            : `${plannedImages} image${plannedImages === 1 ? "" : "s"} from ${draft.models.length} model${draft.models.length === 1 ? "" : "s"}`}
        </span>

        <span class="text-base-content/30 ml-auto hidden text-xs tracking-wide md:block">
          {modifierKey} + Enter
        </span>

        <button
          class="btn btn-primary h-11 min-w-28 max-md:ml-auto"
          type="button"
          disabled={!ready}
          onClick={onGenerate}
        >
          Generate
        </button>
      </div>

      {generationBlockMessage && (
        <p class="bg-error/10 text-error border-base-300 border-t px-3 py-2 text-xs">
          {generationBlockMessage}
        </p>
      )}
    </section>
  );
}
