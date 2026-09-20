import { randomBytes } from "node:crypto";

const SESSION_TTL_MS = 15 * 60 * 1000;

export interface CommandLogWizardData {
  guildId: string;
  channelId?: string;
  excludedRoleIds?: string[];
  excludedUserIds?: string[];
}

interface StoredSession {
  data: CommandLogWizardData;
  expiresAt: number;
}

const sessions = new Map<string, StoredSession>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(id);
  }
}

export function createSession(data: CommandLogWizardData): string {
  purgeExpired();
  const id = randomBytes(8).toString("hex");
  sessions.set(id, { data, expiresAt: Date.now() + SESSION_TTL_MS });
  return id;
}

export function getSession(id: string): CommandLogWizardData | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (session.expiresAt < Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  return session.data;
}

export function updateSession(id: string, data: CommandLogWizardData): void {
  sessions.set(id, { data, expiresAt: Date.now() + SESSION_TTL_MS });
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}