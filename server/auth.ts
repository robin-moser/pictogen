import { createHash, randomBytes, randomUUID } from "node:crypto";

import proxyAddr from "@fastify/proxy-addr";
import { Type } from "@sinclair/typebox";
import argon2 from "argon2";
import { and, eq, gt, lt } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  type AppConfig,
} from "./config.js";
import type { AppDatabase } from "./db.js";
import { authSessions, localCredentials, users } from "./db/schema.js";
import { normalizeUsername } from "./identity.js";
import type { createAssetService } from "./services/assets.js";
import { deleteUserAccount } from "./services/users.js";

const sessionCookie = "pictogen_session";
const sessionLifetimeSeconds = 30 * 24 * 60 * 60;
const sweepIntervalMs = 60 * 60 * 1000;
const maxLoginFailures = 10;
const loginLockoutMs = 15 * 60 * 1000;
const trackedLoginFailures = 1000;

class UsernameTakenError extends Error {}

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
};

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser | null;
  }
}

type AssetService = ReturnType<typeof createAssetService>;

const UsernameSchema = Type.String({
  minLength: 1,
  maxLength: 80,
  pattern: "\\S",
});
const PasswordSchema = Type.String({
  minLength: MINIMUM_PASSWORD_LENGTH,
  maxLength: MAXIMUM_PASSWORD_LENGTH,
});
const CredentialsSchema = Type.Object(
  { username: UsernameSchema, password: PasswordSchema },
  { additionalProperties: false },
);

function validUsername(username: string): string | null {
  const normalized = normalizeUsername(username);
  return normalized.length > 0 && normalized.length <= 80 ? normalized : null;
}

function headerValue(request: FastifyRequest, name: string) {
  const value = request.headers[name];
  if (Array.isArray(value)) return undefined;
  return value?.trim() || undefined;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

export function generatePassword() {
  return randomBytes(18).toString("base64url");
}

function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

function findSessionUser(
  database: AppDatabase,
  token: string,
): AuthUser | null {
  const match = database.orm
    .select({
      user: users,
      mustChangePassword: localCredentials.mustChangePassword,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .innerJoin(localCredentials, eq(localCredentials.userId, users.id))
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash(token)),
        gt(authSessions.expiresAt, new Date().toISOString()),
      ),
    )
    .get();

  if (!match) return null;
  return {
    id: match.user.id,
    username: match.user.username,
    displayName: match.user.displayName,
    isAdmin: match.user.isAdmin,
    mustChangePassword: match.mustChangePassword,
  };
}

export async function setLocalPassword(
  database: AppDatabase,
  userId: string,
  password: string,
  mustChangePassword: boolean,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  database.orm.transaction((tx) => {
    tx.insert(localCredentials)
      .values({
        userId,
        passwordHash,
        mustChangePassword,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: localCredentials.userId,
        set: { passwordHash, mustChangePassword, updatedAt: now },
      })
      .run();
    tx.delete(authSessions).where(eq(authSessions.userId, userId)).run();
  });
}

export async function createOrAttachLocalUser(
  database: AppDatabase,
  account: {
    username: string;
    password: string;
    isAdmin: boolean;
    mustChangePassword: boolean;
  },
): Promise<string> {
  const username = validUsername(account.username);
  if (!username) throw new Error("Username is invalid.");
  const passwordHash = await hashPassword(account.password);
  const now = new Date().toISOString();

  return database.orm.transaction((tx) => {
    const existing = tx
      .select()
      .from(users)
      .where(eq(users.username, username))
      .get();
    const userId = existing?.id ?? randomUUID();

    if (
      existing &&
      tx
        .select({ userId: localCredentials.userId })
        .from(localCredentials)
        .where(eq(localCredentials.userId, existing.id))
        .get()
    ) {
      throw new UsernameTakenError();
    }

    if (existing) {
      if (account.isAdmin && !existing.isAdmin) {
        tx.update(users)
          .set({ isAdmin: true, updatedAt: now })
          .where(eq(users.id, userId))
          .run();
      }
    } else {
      tx.insert(users)
        .values({
          id: userId,
          username,
          displayName: account.username.trim(),
          isAdmin: account.isAdmin,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    tx.insert(localCredentials)
      .values({
        userId,
        passwordHash,
        mustChangePassword: account.mustChangePassword,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return userId;
  });
}

function findOrCreateForwardAuthUser(
  database: AppDatabase,
  suppliedUsername: string,
): AuthUser | null {
  const username = validUsername(suppliedUsername);
  if (!username) return null;
  const now = new Date().toISOString();
  database.orm
    .insert(users)
    .values({
      id: randomUUID(),
      username,
      displayName: suppliedUsername.trim(),
      isAdmin: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: users.username })
    .run();
  const user = database.orm
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();
  return user
    ? {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
        mustChangePassword: false,
      }
    : null;
}

function findOrCreateDemoUser(
  database: AppDatabase,
  suppliedUsername: string,
): AuthUser {
  const username = validUsername(suppliedUsername);
  if (!username) throw new Error("DEMO_USERNAME is invalid.");
  const now = new Date().toISOString();
  database.orm
    .insert(users)
    .values({
      id: randomUUID(),
      username,
      displayName: suppliedUsername.trim(),
      isAdmin: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: users.username })
    .run();
  const user = database.orm
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();
  if (!user) throw new Error("Demo user could not be created.");
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: false,
    mustChangePassword: false,
  };
}

function createSession(database: AppDatabase, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  database.orm
    .insert(authSessions)
    .values({
      tokenHash: tokenHash(token),
      userId,
      expiresAt: new Date(
        now.getTime() + sessionLifetimeSeconds * 1000,
      ).toISOString(),
      createdAt: now.toISOString(),
    })
    .run();
  return token;
}

function sessionCookieOptions(config: AppConfig) {
  return {
    path: "/",
    httpOnly: true,
    secure: config.publicUrl.protocol === "https:",
    sameSite: "lax" as const,
  };
}

function removeExpired(database: AppDatabase) {
  database.orm
    .delete(authSessions)
    .where(lt(authSessions.expiresAt, new Date().toISOString()))
    .run();
}

function hasLocalAdministrator(database: AppDatabase) {
  return Boolean(
    database.orm
      .select({ id: users.id })
      .from(users)
      .innerJoin(localCredentials, eq(localCredentials.userId, users.id))
      .where(eq(users.isAdmin, true))
      .limit(1)
      .get(),
  );
}

function localAdministratorCount(database: AppDatabase) {
  return database.orm
    .select({ id: users.id })
    .from(users)
    .innerJoin(localCredentials, eq(localCredentials.userId, users.id))
    .where(eq(users.isAdmin, true))
    .all().length;
}

export async function seedAdministrator(
  database: AppDatabase,
  config: AppConfig,
): Promise<void> {
  if (config.authMode !== "local" || hasLocalAdministrator(database)) return;
  const generated =
    config.adminPassword === undefined ? generatePassword() : null;
  const password = config.adminPassword ?? generated;
  if (!password) return;
  const username = validUsername(config.adminUsername);
  if (!username)
    throw new Error("ADMIN_USERNAME must contain a valid username.");
  const existing = database.orm
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();

  if (existing) {
    database.orm
      .update(users)
      .set({ isAdmin: true, updatedAt: new Date().toISOString() })
      .where(eq(users.id, existing.id))
      .run();
    await setLocalPassword(database, existing.id, password, generated !== null);
  } else {
    await createOrAttachLocalUser(database, {
      username: config.adminUsername,
      password,
      isAdmin: true,
      mustChangePassword: generated !== null,
    });
  }

  if (generated) {
    process.stdout.write(
      [
        "",
        "  ".padEnd(64, "="),
        "  Pictogen created the first administrator account.",
        `  Username: ${username}`,
        `  Password: ${generated}`,
        "  This password is shown once and must be changed at first sign-in.",
        "  Set ADMIN_PASSWORD to choose it yourself instead.",
        "  ".padEnd(64, "="),
        "",
        "",
      ].join("\n"),
    );
  }
}

export function createLoginFailureTracker() {
  const failures = new Map<string, { count: number; resetAt: number }>();
  return {
    lockedOutUntil(username: string) {
      const failure = failures.get(username);
      if (!failure) return 0;
      if (failure.resetAt <= Date.now()) {
        failures.delete(username);
        return 0;
      }
      return failure.count >= maxLoginFailures ? failure.resetAt : 0;
    },
    record(username: string) {
      const now = Date.now();
      const current = failures.get(username);
      if (!current) {
        for (const [key, value] of failures) {
          if (value.resetAt <= now) failures.delete(key);
        }
        while (failures.size >= trackedLoginFailures) {
          let earliest: string | undefined;
          let earliestReset = Infinity;
          for (const [key, value] of failures) {
            if (value.resetAt < earliestReset) {
              earliest = key;
              earliestReset = value.resetAt;
            }
          }
          if (earliest === undefined) break;
          failures.delete(earliest);
        }
      }
      failures.set(
        username,
        current && current.resetAt > now
          ? { count: current.count + 1, resetAt: current.resetAt }
          : { count: 1, resetAt: now + loginLockoutMs },
      );
    },
    clear(username: string) {
      failures.delete(username);
    },
    get size() {
      return failures.size;
    },
  };
}

const administratorRequired = {
  error: {
    code: "ADMIN_REQUIRED",
    message: "Administrator access is required.",
  },
};

const lastAdministratorRequired = {
  error: {
    code: "LAST_ADMIN_REQUIRED",
    message: "At least one local administrator must remain.",
  },
};

export async function registerAuthentication(
  app: FastifyInstance,
  config: AppConfig,
  database: AppDatabase,
  assetService: AssetService,
) {
  const trustForwardAuthPeer =
    config.authMode === "forward-auth"
      ? proxyAddr.compile([...config.forwardAuth.trustedProxies])
      : () => false;
  const loginFailures = createLoginFailureTracker();
  const absentPasswordHash =
    config.authMode === "local" ? await hashPassword(generatePassword()) : "";

  const demoUser =
    config.authMode === "demo"
      ? findOrCreateDemoUser(database, config.demoUsername)
      : null;

  if (config.authMode === "forward-auth") {
    database.orm.delete(authSessions).run();
  } else if (config.authMode === "local") {
    removeExpired(database);
    await seedAdministrator(database, config);
  }

  const sweep = setInterval(() => removeExpired(database), sweepIntervalMs);
  sweep.unref();
  app.addHook("onClose", () => clearInterval(sweep));
  app.decorateRequest("authUser", null);

  const publicPaths = new Set(["/api/health", "/api/auth/config"]);
  if (config.authMode === "local") {
    publicPaths.add("/api/auth/login");
    publicPaths.add("/api/auth/logout");
  }
  const passwordChangePaths = new Set([
    ...publicPaths,
    "/api/me",
    "/api/auth/password",
  ]);

  app.addHook("onRequest", (request, reply, done) => {
    const pathname = request.url.split("?", 1)[0];
    if (!pathname?.startsWith("/api/") || publicPaths.has(pathname)) {
      done();
      return;
    }

    if (config.authMode === "local") {
      const token = request.cookies[sessionCookie];
      request.authUser = token ? findSessionUser(database, token) : null;
    } else if (config.authMode === "forward-auth") {
      const address = request.socket.remoteAddress;
      request.authUser =
        address && trustForwardAuthPeer(address, 0)
          ? findOrCreateForwardAuthUser(
              database,
              headerValue(request, config.forwardAuth.userHeader) ?? "",
            )
          : null;
    } else {
      request.authUser = demoUser;
    }

    if (!request.authUser) {
      void reply.code(401).send({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Sign in to continue.",
        },
      });
      return;
    }
    if (
      request.authUser.mustChangePassword &&
      !passwordChangePaths.has(pathname)
    ) {
      void reply.code(403).send({
        error: {
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "Choose a new password to continue.",
        },
      });
      return;
    }
    if (
      config.authMode === "demo" &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)
    ) {
      void reply.code(403).send({
        error: {
          code: "DEMO_READ_ONLY",
          message: "The demo workspace is read-only.",
        },
      });
      return;
    }
    done();
  });

  app.get("/api/auth/config", () => ({
    mode: config.authMode,
    minimumPasswordLength: MINIMUM_PASSWORD_LENGTH,
  }));

  if (config.authMode !== "local") return;

  app.post<{ Body: { username: string; password: string } }>(
    "/api/auth/login",
    {
      schema: { body: CredentialsSchema },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const username = normalizeUsername(request.body.username);
      const lockedUntil = loginFailures.lockedOutUntil(username);
      if (lockedUntil) {
        return reply
          .code(429)
          .header(
            "Retry-After",
            Math.ceil((lockedUntil - Date.now()) / 1000).toString(),
          )
          .send({
            error: {
              code: "TOO_MANY_ATTEMPTS",
              message: "Too many failed attempts. Try again later.",
            },
          });
      }

      const credential = database.orm
        .select({ credential: localCredentials, user: users })
        .from(localCredentials)
        .innerJoin(users, eq(users.id, localCredentials.userId))
        .where(eq(users.username, username))
        .get();
      const valid = await argon2.verify(
        credential?.credential.passwordHash ?? absentPasswordHash,
        request.body.password,
      );
      if (!credential || !valid) {
        loginFailures.record(username);
        return reply.code(401).send({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "The username or password is incorrect.",
          },
        });
      }

      loginFailures.clear(username);
      reply.setCookie(
        sessionCookie,
        createSession(database, credential.user.id),
        {
          ...sessionCookieOptions(config),
          maxAge: sessionLifetimeSeconds,
        },
      );
      return {
        user: credential.user.displayName,
        mustChangePassword: credential.credential.mustChangePassword,
      };
    },
  );

  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/api/auth/password",
    {
      schema: {
        body: Type.Object(
          { currentPassword: PasswordSchema, newPassword: PasswordSchema },
          { additionalProperties: false },
        ),
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const credential = request.authUser
        ? database.orm
            .select()
            .from(localCredentials)
            .where(eq(localCredentials.userId, request.authUser.id))
            .get()
        : undefined;
      if (!credential) {
        return reply.code(404).send({
          error: {
            code: "PASSWORD_UNAVAILABLE",
            message: "This account does not use a local password.",
          },
        });
      }
      if (
        !(await argon2.verify(
          credential.passwordHash,
          request.body.currentPassword,
        ))
      ) {
        return reply.code(401).send({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "The current password is incorrect.",
          },
        });
      }
      await setLocalPassword(
        database,
        credential.userId,
        request.body.newPassword,
        false,
      );
      reply.setCookie(
        sessionCookie,
        createSession(database, credential.userId),
        {
          ...sessionCookieOptions(config),
          maxAge: sessionLifetimeSeconds,
        },
      );
      return reply.code(204).send();
    },
  );

  app.post("/api/auth/logout", (request, reply) => {
    const token = request.cookies[sessionCookie];
    if (token) {
      database.orm
        .delete(authSessions)
        .where(eq(authSessions.tokenHash, tokenHash(token)))
        .run();
    }
    reply.clearCookie(sessionCookie, sessionCookieOptions(config));
    return reply.code(204).send();
  });

  function requireAdministrator(request: FastifyRequest) {
    return Boolean(request.authUser?.isAdmin);
  }

  app.get("/api/users", (request, reply) => {
    if (!requireAdministrator(request)) {
      return reply.code(403).send(administratorRequired);
    }
    return database.orm
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        isAdmin: users.isAdmin,
        credentialUserId: localCredentials.userId,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(localCredentials, eq(localCredentials.userId, users.id))
      .all()
      .map(({ credentialUserId, ...user }) => ({
        ...user,
        hasLocalCredentials: credentialUserId !== null,
      }));
  });

  app.post<{
    Body: { username: string; password: string; isAdmin?: boolean };
  }>(
    "/api/users",
    {
      schema: {
        body: Type.Object(
          {
            username: UsernameSchema,
            password: PasswordSchema,
            isAdmin: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      if (!requireAdministrator(request)) {
        return reply.code(403).send(administratorRequired);
      }
      const isAdmin = request.body.isAdmin ?? false;
      try {
        const id = await createOrAttachLocalUser(database, {
          username: request.body.username,
          password: request.body.password,
          isAdmin,
          mustChangePassword: false,
        });
        reply.code(201);
        return {
          id,
          username: normalizeUsername(request.body.username),
          isAdmin,
        };
      } catch (error) {
        if (error instanceof UsernameTakenError) {
          return reply.code(409).send({
            error: {
              code: "USERNAME_TAKEN",
              message: "That username is already in use.",
            },
          });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { userId: string }; Body: { password: string } }>(
    "/api/users/:userId/password",
    {
      schema: {
        params: Type.Object({ userId: Type.String({ minLength: 1 }) }),
        body: Type.Object(
          { password: PasswordSchema },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      if (!requireAdministrator(request)) {
        return reply.code(403).send(administratorRequired);
      }
      const target = database.orm
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, request.params.userId))
        .get();
      if (!target) {
        return reply.code(404).send({
          error: { code: "USER_NOT_FOUND", message: "That account is gone." },
        });
      }
      const resettingSelf = target.id === request.authUser?.id;
      await setLocalPassword(
        database,
        target.id,
        request.body.password,
        !resettingSelf,
      );
      if (resettingSelf) {
        reply.setCookie(sessionCookie, createSession(database, target.id), {
          ...sessionCookieOptions(config),
          maxAge: sessionLifetimeSeconds,
        });
      }
      return reply.code(204).send();
    },
  );

  app.patch<{ Params: { userId: string }; Body: { isAdmin: boolean } }>(
    "/api/users/:userId",
    {
      schema: {
        params: Type.Object({ userId: Type.String({ minLength: 1 }) }),
        body: Type.Object(
          { isAdmin: Type.Boolean() },
          { additionalProperties: false },
        ),
      },
    },
    (request, reply) => {
      if (!requireAdministrator(request)) {
        return reply.code(403).send(administratorRequired);
      }
      const target = database.orm
        .select({ user: users, credentialUserId: localCredentials.userId })
        .from(users)
        .leftJoin(localCredentials, eq(localCredentials.userId, users.id))
        .where(eq(users.id, request.params.userId))
        .get();
      if (!target) {
        return reply.code(404).send({
          error: { code: "USER_NOT_FOUND", message: "That account is gone." },
        });
      }
      if (
        !request.body.isAdmin &&
        target.user.isAdmin &&
        target.credentialUserId !== null &&
        localAdministratorCount(database) <= 1
      ) {
        return reply.code(409).send(lastAdministratorRequired);
      }
      database.orm
        .update(users)
        .set({
          isAdmin: request.body.isAdmin,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, target.user.id))
        .run();
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { userId: string } }>(
    "/api/users/:userId",
    {
      schema: {
        params: Type.Object({ userId: Type.String({ minLength: 1 }) }),
      },
    },
    async (request, reply) => {
      if (!requireAdministrator(request)) {
        return reply.code(403).send(administratorRequired);
      }
      const target = database.orm
        .select({ user: users, credentialUserId: localCredentials.userId })
        .from(users)
        .leftJoin(localCredentials, eq(localCredentials.userId, users.id))
        .where(eq(users.id, request.params.userId))
        .get();
      if (!target) {
        return reply.code(404).send({
          error: { code: "USER_NOT_FOUND", message: "That account is gone." },
        });
      }
      if (target.user.id === request.authUser?.id) {
        return reply.code(409).send({
          error: {
            code: "SELF_REMOVAL_FORBIDDEN",
            message: "You cannot remove your own account.",
          },
        });
      }
      if (
        target.user.isAdmin &&
        target.credentialUserId !== null &&
        localAdministratorCount(database) <= 1
      ) {
        return reply.code(409).send(lastAdministratorRequired);
      }
      await deleteUserAccount(database, assetService, target.user.id);
      return reply.code(204).send();
    },
  );
}

export function resolveUser(request: FastifyRequest): string {
  if (!request.authUser)
    throw new Error("Authenticated user was not resolved.");
  return request.authUser.id;
}
