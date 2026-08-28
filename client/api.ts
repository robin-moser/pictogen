import type {
  SessionDetail,
  SessionDraft,
  SessionSummary,
} from "../shared/contracts.js";

type ErrorResponse = {
  error?: {
    message?: string;
  };
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
  return request<{ user: string }>("/api/me", { signal: signal ?? null });
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
