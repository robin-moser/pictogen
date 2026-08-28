import type { FastifyRequest } from "fastify";

export function resolveUser(request: FastifyRequest): string {
  const remoteUser = request.headers["remote-user"];
  const value = Array.isArray(remoteUser) ? remoteUser[0] : remoteUser;

  return value?.trim() || "user";
}
