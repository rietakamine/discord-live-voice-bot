import { randomBytes } from "node:crypto";

const SESSION_TTL_MS = 15 * 60 * 1000;

interface StoredSession<T> {
  data: T;
  expiresAt: number;
}

const sessions = new Map<string, StoredSession<unknown>>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(id);
  }
}

export function createSession<T>(data: T): string {
  purgeExpired();
  const id = randomBytes(8).toString("hex");
  sessions.set(id, { data, expiresAt: Date.now() + SESSION_TTL_MS });
  return id;
}

export function getSession<T>(id: string): T | undefined {
  const session = sessions.get(id) as StoredSession<T> | undefined;
  if (!session) return undefined;
  if (session.expiresAt < Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  return session.data;
}

export function updateSession<T>(id: string, data: T): void {
  sessions.set(id, { data, expiresAt: Date.now() + SESSION_TTL_MS });
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}