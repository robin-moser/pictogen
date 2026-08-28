import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../server/app.js";
import { parseConfig } from "../server/config.js";
import { openDatabase } from "../server/db.js";
import { createOpenRouterProvider } from "../server/providers/openrouter.js";

const directories: string[] = [];
afterEach(() =>
  directories
    .splice(0)
    .forEach((directory) =>
      rmSync(directory, { recursive: true, force: true }),
    ),
);

describe("generation API", () => {
  it("creates an idempotent run and persists its output and actual cost", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "pictogen-generation-"));
    directories.push(dataDir);
    const config = parseConfig({
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      OPENROUTER_API_KEY: "test-key",
    });
    const app = await buildApp({
      config,
      database: openDatabase({ databasePath: config.databasePath }),
      provider: {
        id: "test",
        displayName: "Test",
        listImageModels: async () => [
          {
            providerId: "test",
            modelId: "image",
            name: "Image",
            inputModalities: ["text"],
          },
        ],
        generateImages: async () => ({
          images: [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
          usage: { cost: 0.000002 },
        }),
      },
    });
    const session = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Test" },
    });
    const sessionId = session.json<{ id: string }>().id;
    const request = {
      method: "POST" as const,
      url: `/api/sessions/${sessionId}/runs`,
      headers: { "idempotency-key": "run-1" },
      payload: {
        prompt: "A test image",
        models: [{ providerId: "test", modelId: "image" }],
        count: 1,
        options: { resolution: "1K", aspectRatio: "1:1" },
        referenceAssetIds: [],
      },
    };
    expect((await app.inject(request)).statusCode).toBe(202);
    expect((await app.inject(request)).json()).toMatchObject({
      run: { jobs: [{ status: "queued" }] },
    });
    app.generationWorker.start();
    let detail = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
    });
    for (let attempts = 0; attempts < 20; attempts += 1) {
      detail = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}`,
      });
      if (
        detail.json<{ runs: { jobs: { status: string }[] }[] }>().runs[0]
          ?.jobs[0]?.status === "succeeded"
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(detail.json()).toMatchObject({
      knownCostMicrousd: 2,
      costComplete: true,
      runs: [
        {
          jobs: [
            {
              status: "succeeded",
              completedCount: 1,
              outputs: [{ kind: "output" }],
            },
          ],
        },
      ],
    });
    await app.close();
  });
});

describe("OpenRouter errors", () => {
  it("keeps a safe provider rejection detail", async () => {
    const provider = createOpenRouterProvider(
      parseConfig({ NODE_ENV: "test", OPENROUTER_API_KEY: "test-key" }),
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "The selected model does not support 4K.",
              metadata: { error_type: "invalid_request" },
            },
          }),
          { status: 400 },
        ),
    );
    await expect(
      provider.generateImages?.({
        modelId: "test/image",
        prompt: "Test",
        count: 1,
        references: [],
      }),
    ).rejects.toThrow(
      "OpenRouter 400 (invalid_request): The selected model does not support 4K.",
    );
  });
});
