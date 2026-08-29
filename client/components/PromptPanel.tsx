import type { ComponentChildren } from "preact";

import { composePrompt } from "../../shared/contracts.js";
import type { SessionDraft } from "../../shared/contracts.js";

const modifierKey =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘"
    : "Ctrl";

const modifierGroups = [
  {
    key: "shot",
    label: "Add shot...",
    color: "text-info",
    badge: "badge-info",
    options: [
      [", extreme close-up", "extreme close-up"],
      [", low-angle shot", "low-angle"],
      [", high-angle shot", "high-angle"],
      [", aerial shot", "aerial"],
      [", close-up shot", "close-up"],
      [", close-up portrait", "portrait"],
      [", macro shot", "macro"],
      [", wide-angle shot", "wide-angle"],
      [", establishing shot", "establishing"],
      [", over-the-shoulder shot", "over-the-shoulder"],
      [", telephoto shot", "telephoto"],
      [", handheld shot", "handheld"],
      [", panoramic shot", "panoramic"],
      [", dramatic angle, extreme angle shot", "dramatic"],
    ],
  },
  {
    key: "color",
    label: "Add color...",
    color: "text-warning",
    badge: "badge-warning",
    options: [
      [", vibrant color grading", "vibrant"],
      [", warm color grading", "warm"],
      [", cool-toned color grading", "cool"],
      [", pastel color grading", "pastel"],
      [", bright color grading", "bright"],
      [", muted color grading", "muted"],
      [", neon color grading", "neon"],
      [", duotone color grading", "duotone"],
      [", monochrome", "monochrome"],
      [", cool-toned sterile colors", "sterile"],
    ],
  },
  {
    key: "effect",
    label: "Add effect...",
    color: "text-secondary",
    badge: "badge-secondary",
    options: [
      [", bokeh", "bokeh"],
      [", tilt-shift effect", "tilt-shift"],
      [", soft focus", "soft focus"],
      [", shallow depth of field", "background blur"],
      [", chromatic aberrations", "chromatic aberrations"],
      [", light leaks", "light leaks"],
      [", rear projection", "rear projection"],
      [", lens flare", "lens flare"],
      [", long exposure", "long exposure"],
      [", golden hour", "golden hour"],
      [", silhouette", "silhouette"],
    ],
  },
] as const;

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
  const composedPrompt = composePrompt(draft);
  const ready =
    Boolean(composedPrompt.trim()) &&
    composedPrompt.length <= 12_000 &&
    draft.models.length > 0 &&
    !generationBlocked;
  const plannedImages = draft.models.length * draft.count;

  function selectModifier(
    key: keyof SessionDraft["promptModifiers"],
    value: string,
  ) {
    onDraftChange({
      ...draft,
      promptModifiers: {
        ...draft.promptModifiers,
        [key]: value || undefined,
      },
    });
  }

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

      {modifierGroups.some((group) => draft.promptModifiers[group.key]) && (
        <div
          class="flex min-h-7 flex-wrap items-center gap-1.5 px-4 pb-3"
          aria-label="Added prompt modifiers"
        >
          {modifierGroups.map((group) => {
            const modifier = draft.promptModifiers[group.key];
            return modifier ? (
              <span class={`badge badge-sm badge-outline ${group.badge}`}>
                {modifier.slice(2)}
              </span>
            ) : null;
          })}
        </div>
      )}

      <div class="border-base-300 flex flex-wrap items-center gap-2 border-t px-3 py-3">
        {modifierGroups.map((group) => (
          <select
            class={`select select-bordered h-11 min-h-11 w-28 text-xs ${group.color}`}
            aria-label={group.label}
            value={draft.promptModifiers[group.key] ?? ""}
            onChange={(event) =>
              selectModifier(group.key, event.currentTarget.value)
            }
          >
            <option value="">{group.label}</option>
            {group.options.map(([value, label]) => (
              <option value={value}>{label}</option>
            ))}
          </select>
        ))}

        <span
          class={`ml-1 text-xs tabular-nums ${composedPrompt.length > 12_000 ? "text-error" : "text-base-content/35"}`}
        >
          {composedPrompt.length.toLocaleString()}
        </span>

        <span class="text-base-content/45 hidden text-xs sm:block">
          {draft.models.length === 0
            ? "No model selected"
            : `${plannedImages} image${plannedImages === 1 ? "" : "s"} from ${draft.models.length} model${draft.models.length === 1 ? "" : "s"}`}
        </span>

        <span class="text-base-content/30 ml-auto hidden text-xs tracking-wide lg:block">
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
