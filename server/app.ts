import { resolve } from "node:path";

import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import { TypeBoxValidatorCompiler } from "@fastify/type-provider-typebox";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import Fastify from "fastify";

import type { AppConfig } from "./config.js";
import type { AppDatabase } from "./db.js";
import { registerSessionRoutes } from "./routes/sessions.js";

type BuildAppOptions = {
  config: AppConfig;
  database: AppDatabase;
};

const HealthResponse = Type.Object({
  status: Type.Union([Type.Literal("ok"), Type.Literal("unhealthy")]),
});

export async function buildApp({ config, database }: BuildAppOptions) {
  const app = Fastify({
    logger: config.nodeEnv !== "test",
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.setValidatorCompiler(TypeBoxValidatorCompiler);

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

  app.addHook("onRequest", (request, reply, done) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      done();
      return;
    }

    const origin = request.headers.origin;

    if (origin && origin !== config.publicUrl.origin) {
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

  await registerSessionRoutes(app, database);

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
    database.close();
  });

  return app;
}
