import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";

import {
  ErrorResponseSchema,
  ModelCatalogSchema,
} from "../../shared/contracts.js";
import type { ModelCatalog } from "../../shared/contracts.js";

const ModelQuerySchema = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);

export function registerModelRoutes(
  app: FastifyInstance,
  catalog: { load: () => Promise<ModelCatalog> },
) {
  app.get<{ Querystring: { q?: string } }>(
    "/api/models",
    {
      schema: {
        querystring: ModelQuerySchema,
        response: { 200: ModelCatalogSchema, 503: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const result = await catalog.load();
        const query = request.query.q?.trim().toLocaleLowerCase();

        if (!query) {
          return result;
        }

        return {
          ...result,
          models: result.models.filter((model) =>
            [model.providerId, model.modelId, model.name, model.description]
              .filter((value): value is string => Boolean(value))
              .some((value) => value.toLocaleLowerCase().includes(query)),
          ),
        };
      } catch {
        return reply.code(503).send({
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message: "The model catalog is currently unavailable.",
          },
        });
      }
    },
  );
}
