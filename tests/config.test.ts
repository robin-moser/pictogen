import { describe, expect, it } from "vitest";

import { parseConfig } from "../server/config.js";

describe("parseConfig", () => {
  it("applies safe development defaults", () => {
    const config = parseConfig({
      OPENROUTER_API_KEY: "test-key",
      AUTH_MODE: "local",
    });

    expect(config).toMatchObject({
      nodeEnv: "development",
      host: "0.0.0.0",
      port: 3000,
      globalConcurrency: 3,
      perUserConcurrency: 3,
      maxUploadBytes: 15_728_640,
      modelCacheTtlSeconds: 3600,
      authMode: "local",
      trustProxy: false,
    });
    expect(config.publicUrl.href).toBe("http://localhost:3000/");
    expect(config.databasePath).toBe(`${config.dataDir}/pictogen.sqlite`);
  });

  it("rejects missing required configuration", () => {
    expect(() => parseConfig({ OPENROUTER_API_KEY: "test-key" })).toThrow(
      "AUTH_MODE must be local or forward-auth.",
    );
    expect(() => parseConfig({ AUTH_MODE: "local" })).toThrow(
      "OPENROUTER_API_KEY must be set.",
    );
    expect(() =>
      parseConfig({
        NODE_ENV: "production",
        OPENROUTER_API_KEY: "test-key",
        AUTH_MODE: "local",
      }),
    ).toThrow("PUBLIC_URL must be set.");
  });

  it("rejects invalid numeric configuration", () => {
    expect(() =>
      parseConfig({
        OPENROUTER_API_KEY: "test-key",
        AUTH_MODE: "local",
        PORT: "70000",
      }),
    ).toThrow("PORT must be at most 65535.");
  });

  it("accepts exactly one authentication mode", () => {
    for (const mode of ["", "oidc", "local,forward-auth", "local,"]) {
      expect(() =>
        parseConfig({ OPENROUTER_API_KEY: "test-key", AUTH_MODE: mode }),
      ).toThrow("AUTH_MODE must be local or forward-auth.");
    }

    expect(() =>
      parseConfig({
        OPENROUTER_API_KEY: "test-key",
        AUTH_MODE: "forward-auth",
      }),
    ).toThrow("FORWARD_AUTH_TRUSTED_PROXIES must be set");
    expect(
      parseConfig({
        OPENROUTER_API_KEY: "test-key",
        AUTH_MODE: "forward-auth",
        FORWARD_AUTH_TRUSTED_PROXIES: "127.0.0.1/32",
      }).authMode,
    ).toBe("forward-auth");
  });

  it("keeps proxy trust separate and compares complete origins", () => {
    const config = parseConfig({
      OPENROUTER_API_KEY: "test-key",
      AUTH_MODE: "forward-auth",
      FORWARD_AUTH_TRUSTED_PROXIES: "127.0.0.1",
      FORWARD_AUTH_USER_HEADER: "X-Authenticated-User",
      TRUSTED_ORIGINS: "https://example.test:8443/path",
    });

    expect(config.trustProxy).toBe(false);
    expect(config.forwardAuth.userHeader).toBe("x-authenticated-user");
    expect(config.trustedOrigins).toEqual(["https://example.test:8443"]);
  });
});
