import { resolve } from "node:path";

import proxyAddr from "@fastify/proxy-addr";

export const MINIMUM_PASSWORD_LENGTH = 8;
export const MAXIMUM_PASSWORD_LENGTH = 256;

const DEFAULTS = {
  host: "0.0.0.0",
  port: 3000,
  globalConcurrency: 3,
  perUserConcurrency: 3,
  maxUploadBytes: 15_728_640,
  modelCacheTtlSeconds: 3600,
} as const;

export type AuthMode = "local" | "forward-auth";

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
  authMode: AuthMode;
  adminUsername: string;
  adminPassword?: string;
  trustedOrigins: readonly string[];
  trustProxy: boolean | readonly string[];
  forwardAuth: Readonly<{
    userHeader: string;
    trustedProxies: readonly string[];
  }>;
}>;

function authMode(value: string | undefined): AuthMode {
  const mode = value?.trim();
  if (mode !== "local" && mode !== "forward-auth") {
    throw new Error("AUTH_MODE must be local or forward-auth.");
  }
  return mode;
}

function headerName(value: string | undefined, fallback: string, name: string) {
  const header = value?.trim().toLowerCase() || fallback;
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(header)) {
    throw new Error(`${name} must be a valid HTTP header name.`);
  }
  return header;
}

function requiredValue(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} must be set.`);
  return value.trim();
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function nodeEnvironment(value: string | undefined): AppConfig["nodeEnv"] {
  const environment = value ?? "development";
  if (
    environment !== "development" &&
    environment !== "test" &&
    environment !== "production"
  ) {
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

function trustedOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return new URL(entry).origin;
      } catch (error) {
        throw new Error(
          `TRUSTED_ORIGINS entries must be absolute URLs, received "${entry}".`,
          { cause: error },
        );
      }
    });
}

function trustProxy(value: string | undefined): boolean | readonly string[] {
  if (value === undefined || value.trim() === "false") return false;
  if (value.trim() === "true") return true;
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error(
      "TRUST_PROXY must be true, false, or a list of trusted peers.",
    );
  }
  proxyAddr.compile(entries);
  return entries;
}

export function resolveDataDir(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(
    environment.DATA_DIR ??
      (nodeEnvironment(environment.NODE_ENV) === "production"
        ? "/data"
        : "data"),
  );
}

export function resolveDatabasePath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(resolveDataDir(environment), "pictogen.sqlite");
}

export function parseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const nodeEnv = nodeEnvironment(environment.NODE_ENV);
  const dataDir = resolveDataDir(environment);
  const port = positiveInteger(environment.PORT, DEFAULTS.port, "PORT");
  const selectedAuthMode = authMode(environment.AUTH_MODE);
  const forwardAuthProxies = (environment.FORWARD_AUTH_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (port > 65_535) throw new Error("PORT must be at most 65535.");
  if (selectedAuthMode === "forward-auth" && forwardAuthProxies.length === 0) {
    throw new Error(
      "FORWARD_AUTH_TRUSTED_PROXIES must be set in forward-auth mode.",
    );
  }
  if (forwardAuthProxies.length > 0) proxyAddr.compile(forwardAuthProxies);

  const adminPassword = environment.ADMIN_PASSWORD;
  if (
    adminPassword !== undefined &&
    (adminPassword.length < MINIMUM_PASSWORD_LENGTH ||
      adminPassword.length > MAXIMUM_PASSWORD_LENGTH)
  ) {
    throw new Error(
      `ADMIN_PASSWORD must be between ${MINIMUM_PASSWORD_LENGTH} and ${MAXIMUM_PASSWORD_LENGTH} characters.`,
    );
  }

  return {
    nodeEnv,
    host: environment.HOST?.trim() || DEFAULTS.host,
    port,
    publicUrl: publicUrl(environment.PUBLIC_URL, nodeEnv),
    dataDir,
    databasePath: resolveDatabasePath(environment),
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
    authMode: selectedAuthMode,
    adminUsername: environment.ADMIN_USERNAME?.trim() || "admin",
    ...(adminPassword !== undefined ? { adminPassword } : {}),
    trustedOrigins: trustedOrigins(environment.TRUSTED_ORIGINS),
    trustProxy: trustProxy(environment.TRUST_PROXY),
    forwardAuth: {
      userHeader: headerName(
        environment.FORWARD_AUTH_USER_HEADER,
        "remote-user",
        "FORWARD_AUTH_USER_HEADER",
      ),
      trustedProxies: forwardAuthProxies,
    },
  };
}
