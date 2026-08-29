import { describe, expect, it } from "vitest";

import {
  composePrompt,
  createEmptyDraft,
  normalizeSessionDraft,
} from "../shared/contracts.js";
import type { SessionDraft } from "../shared/contracts.js";

describe("prompt modifiers", () => {
  it("composes persisted modifiers after the editable prompt", () => {
    const draft: SessionDraft = {
      ...createEmptyDraft(),
      prompt: "A lighthouse in fog",
      promptModifiers: {
        shot: ", low-angle shot",
        color: ", cool-toned color grading",
        effect: ", bokeh",
      },
    };

    expect(composePrompt(draft)).toBe(
      "A lighthouse in fog, low-angle shot, cool-toned color grading, bokeh",
    );
  });

  it("recovers modifiers appended by older drafts", () => {
    const legacyDraft = {
      ...createEmptyDraft(),
      prompt:
        "A lighthouse in fog, low-angle shot, cool-toned color grading, bokeh",
      promptModifiers: undefined,
    } as unknown as SessionDraft;

    expect(normalizeSessionDraft(legacyDraft)).toMatchObject({
      prompt: "A lighthouse in fog",
      promptModifiers: {
        shot: ", low-angle shot",
        color: ", cool-toned color grading",
        effect: ", bokeh",
      },
    });
  });
});
