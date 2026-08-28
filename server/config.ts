import { resolve } from "node:path";

const DEFAULTS = {
  host: "0.0.0.0",
  port: 3000,
  globalConcurrency: 3,
  perUserConcurrency: 3,
  maxUploadBytes: 15_728_640,
  modelCacheTtlSeconds: 3600,
} as const;

export type AppConfig = Readonly<{
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  publicUrl: URL;
  dataDir: string;
  databasePath: string;
  openRouterApiKey: string;
  globalConcurrency: number;
  perUserConcurrency: number;
  maxUploadBytes: number;
  modelCacheTtlSeconds: number;
}>;

function requiredValue(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`${name} must be set.`);
  }

  return value.trim();
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function nodeEnvironment(value: string | undefined): AppConfig["nodeEnv"] {
  const environment = value ?? "development";

  if (!["development", "test", "production"].includes(environment)) {
    throw new Error("NODE_ENV must be development, test, or production.");
  }

  return environment as AppConfig["nodeEnv"];
}

function publicUrl(
  value: string | undefined,
  environment: AppConfig["nodeEnv"],
) {
  const resolved =
    value ??
    (environment === "production" ? undefined : "http://localhost:3000");

  try {
    return new URL(requiredValue(resolved, "PUBLIC_URL"));
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("PUBLIC_URL must be a valid absolute URL.", {
        cause: error,
      });
    }

    throw error;
  }
}

export function parseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const nodeEnv = nodeEnvironment(environment.NODE_ENV);
  const dataDir = resolve(
    environment.DATA_DIR ?? (nodeEnv === "production" ? "/data" : "data"),
  );
  const port = positiveInteger(environment.PORT, DEFAULTS.port, "PORT");

  if (port > 65_535) {
    throw new Error("PORT must be at most 65535.");
  }

  return {
    nodeEnv,
    host: environment.HOST?.trim() || DEFAULTS.host,
    port,
    publicUrl: publicUrl(environment.PUBLIC_URL, nodeEnv),
    dataDir,
    databasePath: resolve(dataDir, "pictogen.sqlite"),
    openRouterApiKey: requiredValue(
      environment.OPENROUTER_API_KEY,
      "OPENROUTER_API_KEY",
    ),
    globalConcurrency: positiveInteger(
      environment.GLOBAL_CONCURRENCY,
      DEFAULTS.globalConcurrency,
      "GLOBAL_CONCURRENCY",
    ),
    perUserConcurrency: positiveInteger(
      environment.PER_USER_CONCURRENCY,
      DEFAULTS.perUserConcurrency,
      "PER_USER_CONCURRENCY",
    ),
    maxUploadBytes: positiveInteger(
      environment.MAX_UPLOAD_BYTES,
      DEFAULTS.maxUploadBytes,
      "MAX_UPLOAD_BYTES",
    ),
    modelCacheTtlSeconds: positiveInteger(
      environment.MODEL_CACHE_TTL_SECONDS,
      DEFAULTS.modelCacheTtlSeconds,
      "MODEL_CACHE_TTL_SECONDS",
    ),
  };
}
