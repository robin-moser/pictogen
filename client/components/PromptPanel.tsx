import type { ComponentChildren } from "preact";

import { composePrompt } from "../../shared/contracts.js";
import type { SessionDraft } from "../../shared/contracts.js";
import { CameraIcon, PaletteIcon, SparklesIcon } from "./Icons.js";

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
    icon: CameraIcon,
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
    color: "text-rose-800 dark:text-rose-300",
    badge:
      "[--badge-color:var(--color-rose-800)] dark:[--badge-color:var(--color-rose-300)]",
    icon: PaletteIcon,
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
    color: "text-indigo-800 dark:text-indigo-300",
    badge:
      "[--badge-color:var(--color-indigo-800)] dark:[--badge-color:var(--color-indigo-300)]",
    icon: SparklesIcon,
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
  settingsControl,
  onDraftChange,
  onGenerate,
  generationBlocked,
  generationBlockMessage,
}: {
  draft: SessionDraft;
  references: ComponentChildren;
  settingsControl?: ComponentChildren;
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
    if (!value) return;

    const current = draft.promptModifiers[key] ?? [];
    if (current.includes(value)) return;

    onDraftChange({
      ...draft,
      promptModifiers: {
        ...draft.promptModifiers,
        [key]: [...current, value],
      },
    });
  }

  function removeModifier(
    key: keyof SessionDraft["promptModifiers"],
    value: string,
  ) {
    const remaining = (draft.promptModifiers[key] ?? []).filter(
      (modifier) => modifier !== value,
    );

    onDraftChange({
      ...draft,
      promptModifiers: {
        ...draft.promptModifiers,
        [key]: remaining.length > 0 ? remaining : undefined,
      },
    });
  }

  return (
    <section class="border-base-300 bg-base-200 focus-within:border-base-content/25 rounded-box flex flex-col overflow-hidden border transition-colors">
      <h2 class="sr-only">Prompt</h2>

      {references}

      <div class="relative">
        {settingsControl && (
          <div class="absolute top-4 right-4 z-10">{settingsControl}</div>
        )}
        <textarea
          class={`textarea min-h-24 w-full resize-none rounded-none border-0 bg-transparent py-5 pl-5 text-[0.95rem] leading-6 focus:outline-none ${settingsControl ? "pr-16" : "pr-5"}`}
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
      </div>

      {modifierGroups.some((group) => draft.promptModifiers[group.key]) && (
        <div
          class="flex min-h-7 flex-wrap items-center gap-2 px-5 pb-4"
          aria-label="Added prompt modifiers"
        >
          {modifierGroups.flatMap((group) =>
            (draft.promptModifiers[group.key] ?? []).map((modifier) => (
              <button
                class={`badge badge-sm badge-outline ${group.badge}`}
                type="button"
                title={`Remove ${modifier.slice(2)}`}
                onClick={() => removeModifier(group.key, modifier)}
              >
                {modifier.slice(2)}
              </button>
            )),
          )}
        </div>
      )}

      <div class="border-base-300 flex flex-wrap items-center gap-2.5 border-t px-4 py-4">
        {modifierGroups.map((group) => {
          const ModifierIcon = group.icon;
          return (
            <label
              class={`btn btn-square border-base-300 bg-base-100 focus-within:outline-base-content/30 relative h-11 min-h-11 focus-within:outline-2 ${group.color}`}
              title={group.label}
            >
              <ModifierIcon class="size-4" />
              <select
                class="absolute inset-0 size-full cursor-pointer opacity-0"
                aria-label={group.label}
                value=""
                onChange={(event) =>
                  selectModifier(group.key, event.currentTarget.value)
                }
              >
                <option value="">{group.label}</option>
                {group.options.map(([value, label]) => (
                  <option value={value}>{label}</option>
                ))}
              </select>
            </label>
          );
        })}

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
