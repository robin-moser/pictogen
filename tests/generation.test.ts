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
    const completed = detail.json<{
      knownCostMicrousd: number;
      costComplete: boolean;
      runs: {
        jobs: { id: string; status: string; outputs: { id: string }[] }[];
      }[];
    }>();
    expect(completed).toMatchObject({
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
    const outputId = completed.runs[0]?.jobs[0]?.outputs[0]?.id;
    const jobId = completed.runs[0]?.jobs[0]?.id;
    expect(outputId).toBeDefined();
    expect(jobId).toBeDefined();
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/assets/${outputId}`,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/sessions/${sessionId}`,
        })
      ).json(),
    ).toMatchObject({
      knownCostMicrousd: 2,
      costComplete: true,
      runs: [{ jobs: [{ status: "succeeded", outputs: [] }] }],
    });
    expect(
      (await app.inject({ method: "DELETE", url: `/api/jobs/${jobId}` }))
        .statusCode,
    ).toBe(409);
    await app.close();
  });

  it("stores an SVG output and serves it under a locked-down policy", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "pictogen-generation-"));
    directories.push(dataDir);
    const config = parseConfig({
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      OPENROUTER_API_KEY: "test-key",
    });
    const svg = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>',
    );
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
        generateImages: async () => ({ images: [svg] }),
      },
    });
    const session = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Test" },
    });
    const sessionId = session.json<{ id: string }>().id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/sessions/${sessionId}/runs`,
          headers: { "idempotency-key": "svg-run" },
          payload: {
            prompt: "A vector image",
            models: [{ providerId: "test", modelId: "image" }],
            count: 1,
            options: { resolution: "1K", aspectRatio: "1:1" },
            referenceAssetIds: [],
          },
        })
      ).statusCode,
    ).toBe(202);
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
    const completed = detail.json<{
      runs: {
        jobs: {
          status: string;
          errorMessage?: string;
          outputs: {
            id: string;
            mimeType: string;
            width: number | null;
            height: number | null;
            blurHash: string | null;
          }[];
        }[];
      }[];
    }>();
    expect(completed.runs[0]?.jobs[0]).toMatchObject({
      status: "succeeded",
      outputs: [
        {
          mimeType: "image/svg+xml",
          width: 8,
          height: 8,
          blurHash: expect.any(String),
        },
      ],
    });
    const asset = await app.inject({
      method: "GET",
      url: `/api/assets/${completed.runs[0]?.jobs[0]?.outputs[0]?.id}`,
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("image/svg+xml");
    expect(asset.headers["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    );
    expect(asset.rawPayload.equals(svg)).toBe(true);
    await app.close();
  });

  it("creates one request per image and cancels only owned queued jobs", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "pictogen-generation-"));
    directories.push(dataDir);
    const config = parseConfig({
      NODE_ENV: "test",
      DATA_DIR: dataDir,
      OPENROUTER_API_KEY: "test-key",
    });
    const generatedRequests: { modelId: string; count: number }[] = [];
    let releaseGeneration: () => void = () => undefined;
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
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
            modelId: "first",
            name: "First",
            inputModalities: ["text"],
          },
          {
            providerId: "test",
            modelId: "second",
            name: "Second",
            inputModalities: ["text"],
          },
        ],
        generateImages: async ({ modelId, count }) => {
          generatedRequests.push({ modelId, count });
          await generationGate;
          return {
            images: [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
            usage: { cost: 0.000001 },
          };
        },
      },
    });
    const session = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Comparison" },
    });
    const sessionId = session.json<{ id: string }>().id;
    const submitted = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/runs`,
      headers: { "idempotency-key": "comparison-1" },
      payload: {
        prompt: "Compare these models",
        models: [
          { providerId: "test", modelId: "first" },
          { providerId: "test", modelId: "second" },
        ],
        count: 2,
        options: { resolution: "1K", aspectRatio: "1:1" },
        referenceAssetIds: [],
      },
    });
    const jobs = submitted.json<{
      run: {
        jobs: {
          id: string;
          modelId: string;
          requestedCount: number;
          status: string;
        }[];
      };
    }>().run.jobs;
    expect(jobs).toHaveLength(4);
    expect(jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelId: "first", requestedCount: 1 }),
        expect.objectContaining({ modelId: "first", requestedCount: 1 }),
        expect.objectContaining({ modelId: "second", requestedCount: 1 }),
        expect.objectContaining({ modelId: "second", requestedCount: 1 }),
      ]),
    );
    const [firstJob, nextJob] = jobs;
    expect(firstJob?.status).toBe("queued");
    expect(nextJob?.status).toBe("queued");

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/jobs/${firstJob?.id}/cancel`,
          headers: { "remote-user": "another-user" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/jobs/${firstJob?.id}/cancel`,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/jobs/${firstJob?.id}/cancel`,
        })
      ).statusCode,
    ).toBe(409);

    let detail = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}`,
    });
    const queuedDetail = detail.json<{
      activeJobCount: number;
      runs: { jobs: { modelId: string; status: string }[] }[];
    }>();
    expect(queuedDetail.activeJobCount).toBe(3);
    expect(
      queuedDetail.runs[0]?.jobs.find((job) => job.modelId === "first")?.status,
    ).toBe("cancelled");

    app.generationWorker.start();
    for (let attempts = 0; attempts < 20; attempts += 1) {
      detail = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}`,
      });
      const currentNext = detail
        .json<{ runs: { jobs: { id: string; status: string }[] }[] }>()
        .runs[0]?.jobs.find((job) => job.id === nextJob?.id);
      if (currentNext?.status === "running") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/jobs/${nextJob?.id}/cancel`,
        })
      ).statusCode,
    ).toBe(409);

    releaseGeneration();
    for (let attempts = 0; attempts < 20; attempts += 1) {
      detail = await app.inject({
        method: "GET",
        url: `/api/sessions/${sessionId}`,
      });
      if (detail.json<{ activeJobCount: number }>().activeJobCount === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(generatedRequests).toEqual([
      { modelId: "first", count: 1 },
      { modelId: "second", count: 1 },
      { modelId: "second", count: 1 },
    ]);
    const completedDetail = detail.json<{
      activeJobCount: number;
      knownCostMicrousd: number;
      costComplete: boolean;
      runs: {
        jobs: {
          modelId: string;
          status: string;
          completedCount: number;
        }[];
      }[];
    }>();
    expect(completedDetail.activeJobCount).toBe(0);
    expect(
      completedDetail.runs[0]?.jobs.find((job) => job.modelId === "first"),
    ).toMatchObject({ status: "cancelled", completedCount: 0 });
    expect(
      completedDetail.runs[0]?.jobs.filter((job) => job.status === "succeeded"),
    ).toHaveLength(3);
    expect(completedDetail).toMatchObject({
      knownCostMicrousd: 3,
      costComplete: true,
    });
    await app.close();
  });

  it("persists effective settings and rejects explicit reference-limit violations", async () => {
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
            modelId: "qwen",
            name: "Qwen",
            inputModalities: ["text"],
            capabilities: {
              maxReferenceImages: 1,
              resolutions: ["1K", "2K"],
              aspectRatios: ["1:1", "3:2"],
              qualities: ["low", "medium"],
            },
          },
        ],
      },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Effective options" },
    });
    const sessionId = created.json<{ id: string }>().id;

    const rejected = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/runs`,
      headers: { "idempotency-key": "too-many-references" },
      payload: {
        prompt: "Too many references",
        models: [{ providerId: "test", modelId: "qwen" }],
        count: 1,
        options: { resolution: "4K", aspectRatio: "3:2" },
        referenceAssetIds: ["one", "two"],
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({
      error: { message: "Qwen accepts at most 1 reference." },
    });

    const accepted = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/runs`,
      headers: { "idempotency-key": "effective-options" },
      payload: {
        prompt: "Map settings",
        models: [{ providerId: "test", modelId: "qwen" }],
        count: 1,
        options: { resolution: "4K", aspectRatio: "3:2", quality: "high" },
        referenceAssetIds: [],
      },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toMatchObject({
      run: {
        options: { resolution: "4K", aspectRatio: "3:2", quality: "high" },
        jobs: [
          {
            effectiveOptions: { resolution: "2K", aspectRatio: "3:2" },
          },
        ],
      },
    });
    await app.close();
  });

  it("hides failed log entries without removing their known cost", async () => {
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
            modelId: "empty",
            name: "Empty",
            inputModalities: ["text"],
          },
        ],
        generateImages: async () => ({
          images: [],
          usage: { cost: 0.000003 },
        }),
      },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/sessions",
      payload: { title: "Failures" },
    });
    const sessionId = created.json<{ id: string }>().id;
    const submitted = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/runs`,
      headers: { "idempotency-key": "failure-1" },
      payload: {
        prompt: "Return nothing",
        models: [{ providerId: "test", modelId: "empty" }],
        count: 2,
        options: { resolution: "1K", aspectRatio: "1:1" },
        referenceAssetIds: [],
      },
    });
    const jobIds = submitted
      .json<{ run: { jobs: { id: string }[] } }>()
      .run.jobs.map((job) => job.id);
    const jobId = jobIds[0];
    expect(jobIds).toHaveLength(2);
    expect(jobId).toBeDefined();
    expect(
      (await app.inject({ method: "DELETE", url: `/api/jobs/${jobId}` }))
        .statusCode,
    ).toBe(409);

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
      if (detail.json<{ activeJobCount: number }>().activeJobCount === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(detail.json()).toMatchObject({
      knownCostMicrousd: 6,
      costComplete: true,
      runs: [{ jobs: [{ status: "failed" }, { status: "failed" }] }],
    });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/jobs/${jobId}`,
          headers: { "remote-user": "another-user" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/sessions/${sessionId}/generation-log`,
          headers: { "remote-user": "another-user" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: "DELETE", url: `/api/jobs/${jobId}` }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/sessions/${sessionId}/generation-log`,
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/sessions/${sessionId}`,
        })
      ).json(),
    ).toMatchObject({
      knownCostMicrousd: 6,
      costComplete: true,
      runs: [{ jobs: [] }],
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
