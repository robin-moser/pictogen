import { describe, expect, it } from "vitest";

import { parseConfig } from "../server/config.js";

describe("parseConfig", () => {
  it("applies safe development defaults", () => {
    const config = parseConfig({
      OPENROUTER_API_KEY: "test-key",
    });

    expect(config).toMatchObject({
      nodeEnv: "development",
      host: "0.0.0.0",
      port: 3000,
      globalConcurrency: 3,
      perUserConcurrency: 3,
      maxUploadBytes: 15_728_640,
      modelCacheTtlSeconds: 3600,
    });
    expect(config.publicUrl.href).toBe("http://localhost:3000/");
    expect(config.databasePath).toBe(`${config.dataDir}/pictogen.sqlite`);
  });

  it("rejects missing required configuration", () => {
    expect(() => parseConfig({})).toThrow("OPENROUTER_API_KEY must be set.");
    expect(() =>
      parseConfig({
        NODE_ENV: "production",
        OPENROUTER_API_KEY: "test-key",
      }),
    ).toThrow("PUBLIC_URL must be set.");
  });

  it("rejects invalid numeric configuration", () => {
    expect(() =>
      parseConfig({
        OPENROUTER_API_KEY: "test-key",
        PORT: "70000",
      }),
    ).toThrow("PORT must be at most 65535.");
  });
});
