import { resolve } from "node:path";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import Fastify from "fastify";
import type { FastifyRequest } from "fastify";

import { registerAuthentication } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerModelRoutes } from "./routes/models.js";
import { createOpenRouterProvider } from "./providers/openrouter.js";
import type { ImageProvider } from "./providers/types.js";
import { createAssetService } from "./services/assets.js";
import {
  createDemoModelCatalog,
  createModelCatalog,
} from "./services/models.js";
import { createGenerationWorker } from "./services/generation.js";
import { registerGenerationRoutes } from "./routes/generation.js";

type BuildAppOptions = {
  config: AppConfig;
  database: AppDatabase;
  provider?: ImageProvider;
};

const HealthResponse = Type.Object({
  status: Type.Union([Type.Literal("ok"), Type.Literal("unhealthy")]),
});

export async function buildApp({
  config,
  database,
  provider,
}: BuildAppOptions) {
  const app = Fastify({
    logger: config.nodeEnv !== "test",
    trustProxy: Array.isArray(config.trustProxy)
      ? [...config.trustProxy]
      : (config.trustProxy as boolean),
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setValidatorCompiler(TypeBoxValidatorCompiler);

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  await app.register(multipart, {
    limits: { files: 1, fileSize: config.maxUploadBytes },
  });

  app.setErrorHandler((error, request, reply) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      error.validation
    ) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request did not match the expected format.",
        },
      });
    }

    request.log.error(error);
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
    });
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "no-referrer" },
  });

  const allowedOrigins = new Set([
    config.publicUrl.origin,
    ...config.trustedOrigins,
  ]);

  function isAllowedOrigin(origin: string, request: FastifyRequest) {
    try {
      const parsed = new URL(origin);
      return (
        allowedOrigins.has(parsed.origin) ||
        (parsed.host === request.host &&
          parsed.protocol === config.publicUrl.protocol)
      );
    } catch {
      return false;
    }
  }

  app.addHook("onRequest", (request, reply, done) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      done();
      return;
    }

    const origin = request.headers.origin;

    if (origin && !isAllowedOrigin(origin, request)) {
      void reply.code(403).send({
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "Cross-origin requests are not allowed.",
        },
      });
      return;
    }

    done();
  });

  app.get(
    "/api/health",
    {
      schema: {
        response: {
          200: HealthResponse,
          503: HealthResponse,
        },
      },
    },
    (_request, reply) => {
      if (!database.isHealthy()) {
        reply.code(503);
        return { status: "unhealthy" } as const;
      }

      return { status: "ok" } as const;
    },
  );

  const assetService = createAssetService(config, database);

  await registerAuthentication(app, config, database, assetService);

  const imageProvider =
    config.authMode === "demo"
      ? null
      : (provider ?? createOpenRouterProvider(config));
  const generationWorker = imageProvider
    ? createGenerationWorker(config, database, imageProvider, assetService)
    : { wake() {}, start() {}, stop() {} };
  await registerSessionRoutes(app, database, assetService);
  registerAssetRoutes(app, database, assetService);
  registerModelRoutes(
    app,
    imageProvider
      ? createModelCatalog(imageProvider, config.modelCacheTtlSeconds)
      : createDemoModelCatalog(database),
  );
  if (imageProvider) {
    registerGenerationRoutes(
      app,
      database,
      imageProvider,
      generationWorker.wake,
    );
  }

  if (config.nodeEnv === "production") {
    await app.register(fastifyStatic, {
      root: resolve("dist/client"),
      wildcard: false,
      index: false,
    });

    app.get("/", (_request, reply) => reply.sendFile("index.html"));

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({
          error: {
            code: "RESOURCE_NOT_FOUND",
            message: "Resource not found.",
          },
        });
      }

      return reply.type("text/html").sendFile("index.html");
    });
  } else {
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({
        error: {
          code: "RESOURCE_NOT_FOUND",
          message: "Resource not found.",
        },
      }),
    );
  }

  app.addHook("onClose", () => {
    generationWorker.stop();
    database.close();
  });

  return Object.assign(app, { generationWorker });
}
