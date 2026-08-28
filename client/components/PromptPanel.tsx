import type { SessionDraft } from "../../shared/contracts.js";
export function PromptPanel({
  draft,
  onDraftChange,
  onGenerate,
  generationBlocked,
  generationBlockMessage,
}: {
  draft: SessionDraft;
  onDraftChange: (draft: SessionDraft) => void;
  onGenerate: () => void;
  generationBlocked: boolean;
  generationBlockMessage: string | undefined;
}) {
  return (
    <section class="border-base-300 focus-within:border-base-content/35 flex min-h-80 flex-col overflow-hidden rounded-box border bg-base-100 shadow-sm transition-colors">
      <h2 class="sr-only">Prompt</h2>
      <textarea
        class="textarea min-h-0 w-full grow resize-none rounded-none border-0 bg-transparent px-5 py-5 text-base leading-7 focus:outline-none sm:px-6 sm:py-6"
        aria-label="Image prompt"
        value={draft.prompt}
        maxLength={12_000}
        placeholder="Describe the image you want to generate..."
        onInput={(event) =>
          onDraftChange({ ...draft, prompt: event.currentTarget.value })
        }
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            if (
              draft.prompt.trim() &&
              draft.models.length &&
              !generationBlocked
            )
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
          disabled={
            !draft.prompt.trim() || !draft.models.length || generationBlocked
          }
          onClick={onGenerate}
        >
          Generate
        </button>
      </div>
      {generationBlockMessage && (
        <p class="bg-error/10 text-error px-4 py-2 text-xs sm:px-5">
          {generationBlockMessage}
        </p>
      )}
    </section>
  );
}
