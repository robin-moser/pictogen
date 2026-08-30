import type {
  Asset,
  CreateRun,
  GenerationRun,
  ModelCatalog,
  SessionDetail,
  SessionDraft,
  SessionSummary,
} from "../shared/contracts.js";

type ErrorResponse = {
  error?: {
    message?: string;
  };
};

export type AuthMode = "local" | "forward-auth" | "demo";

export type AuthConfig = {
  mode: AuthMode;
  minimumPasswordLength: number;
};

export type Identity = {
  id: string;
  user: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
};

export type UserAccount = {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  hasLocalCredentials: boolean;
  createdAt: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init);

  if (!response.ok) {
    let body: ErrorResponse | undefined;

    try {
      body = (await response.json()) as ErrorResponse;
    } catch {
      body = undefined;
    }

    throw new ApiError(
      body?.error?.message || "The request could not be completed.",
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function getIdentity(signal?: AbortSignal) {
  return request<Identity>("/api/me", { signal: signal ?? null });
}

export function getAuthConfig(signal?: AbortSignal) {
  return request<AuthConfig>("/api/auth/config", { signal: signal ?? null });
}

export function authenticateLocal(credentials: {
  username: string;
  password: string;
}) {
  return request<{ user: string; mustChangePassword: boolean }>(
    "/api/auth/login",
    jsonRequest("POST", credentials),
  );
}

export function changePassword(passwords: {
  currentPassword: string;
  newPassword: string;
}) {
  return request<undefined>(
    "/api/auth/password",
    jsonRequest("POST", passwords),
  );
}

export function logout() {
  return request<undefined>("/api/auth/logout", { method: "POST" });
}

export function listUsers() {
  return request<UserAccount[]>("/api/users");
}

export function createUser(account: {
  username: string;
  password: string;
  isAdmin: boolean;
}) {
  return request<{ id: string; username: string; isAdmin: boolean }>(
    "/api/users",
    jsonRequest("POST", account),
  );
}

export function setUserPassword(userId: string, password: string) {
  return request<undefined>(
    `/api/users/${encodeURIComponent(userId)}/password`,
    jsonRequest("POST", { password }),
  );
}

export function setUserAdministrator(userId: string, isAdmin: boolean) {
  return request<undefined>(
    `/api/users/${encodeURIComponent(userId)}`,
    jsonRequest("PATCH", { isAdmin }),
  );
}

export function deleteUser(userId: string) {
  return request<undefined>(`/api/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export function listSessions(signal?: AbortSignal) {
  return request<SessionSummary[]>("/api/sessions", { signal: signal ?? null });
}

export function getSession(sessionId: string, signal?: AbortSignal) {
  return request<SessionDetail>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    { signal: signal ?? null },
  );
}

export function createSession(title: string) {
  return request<SessionDetail>(
    "/api/sessions",
    jsonRequest("POST", { title }),
  );
}

export function updateSession(
  sessionId: string,
  update: { title?: string; draft?: SessionDraft },
) {
  return request<SessionDetail>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    jsonRequest("PATCH", update),
  );
}

export function deleteSession(sessionId: string) {
  return request<undefined>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

export function listModels(signal?: AbortSignal) {
  return request<ModelCatalog>("/api/models", { signal: signal ?? null });
}

export function uploadReference(sessionId: string, file: File) {
  const data = new FormData();
  data.append("sessionId", sessionId);
  data.append("file", file);
  return request<Asset>("/api/assets", { method: "POST", body: data });
}

export function deleteAsset(assetId: string) {
  return request<undefined>(`/api/assets/${encodeURIComponent(assetId)}`, {
    method: "DELETE",
  });
}

export function updateAsset(assetId: string, update: { starred: boolean }) {
  return request<Asset>(
    `/api/assets/${encodeURIComponent(assetId)}`,
    jsonRequest("PATCH", update),
  );
}

export function createRun(sessionId: string, run: CreateRun) {
  return request<{ run: GenerationRun }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/runs`,
    {
      ...jsonRequest("POST", run),
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
    },
  );
}

export function cancelJob(jobId: string) {
  return request<undefined>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });
}

export function dismissJob(jobId: string) {
  return request<undefined>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE",
  });
}

export function clearGenerationLog(sessionId: string) {
  return request<undefined>(
    `/api/sessions/${encodeURIComponent(sessionId)}/generation-log`,
    { method: "DELETE" },
  );
}
