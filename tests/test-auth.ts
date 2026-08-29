import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";

export const forwardAuthTestEnvironment = {
  AUTH_MODE: "forward-auth",
  FORWARD_AUTH_TRUSTED_PROXIES: "127.0.0.1",
} as const;

export function authenticateTestRequests<T extends FastifyInstance>(app: T): T {
  const inject = app.inject.bind(app);
  app.inject = ((options: InjectOptions | string) => {
    if (typeof options === "string") return inject(options);
    return inject({
      ...options,
      headers: { "remote-user": "user", ...options.headers },
    });
  }) as typeof app.inject;
  return app;
}
