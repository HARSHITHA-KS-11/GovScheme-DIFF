import mongoose from 'mongoose';
import { getConfig } from './env';

export interface DatabaseStatus {
  configured: boolean;
  connected: boolean;
  readyState: number;
  stateLabel: string;
  databaseName?: string;
  lastError?: string;
}

const READY_STATE_LABELS: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

let listenersRegistered = false;
let inFlightConnection: Promise<DatabaseStatus> | null = null;
let lastSanitizedError: string | undefined;

export function sanitizeMongoMessage(message: string): string {
  if (!message) return '';
  return message
    .replace(/mongodb(\+srv)?:\/\/[^@\s/]+@/gi, 'mongodb$1://<redacted>@')
    .replace(/(password|pwd|secret|token)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>');
}

function getValidatedMongoUri(): string {
  const raw = (process.env.MONGODB_URI || getConfig().MONGODB_URI || '')
    .replace(/^['"]|['"]$/g, '')
    .trim();

  if (!raw) return '';
  if (
    raw.includes('<db_password>') ||
    raw.includes('<password>') ||
    raw.includes('<username>') ||
    raw.includes('YOUR_MONGODB_ATLAS_URI_HERE')
  ) {
    return '';
  }
  if (!/^mongodb(\+srv)?:\/\//i.test(raw)) {
    return '';
  }
  return raw;
}

function registerConnectionListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  mongoose.connection.on('connected', () => {
    lastSanitizedError = undefined;
    const dbName = mongoose.connection.name || 'default';
    console.log(`🗄️ [MongoDB] Connected cleanly (database: "${dbName}")`);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('🗄️ [MongoDB] Disconnected');
  });

  mongoose.connection.on('error', (err: any) => {
    const safeMsg = sanitizeMongoMessage(err?.message || String(err));
    lastSanitizedError = safeMsg;
    console.warn(`⚠️ [MongoDB] Connection error: ${safeMsg}`);
  });
}

export function getDatabaseStatus(): DatabaseStatus {
  const configured = getValidatedMongoUri().length > 0;
  const readyState = mongoose.connection.readyState;
  const connected = readyState === 1;
  return {
    configured,
    connected,
    readyState,
    stateLabel: READY_STATE_LABELS[readyState] || 'unknown',
    ...(connected && mongoose.connection.name ? { databaseName: mongoose.connection.name } : {}),
    ...(lastSanitizedError && !connected ? { lastError: lastSanitizedError } : {}),
  };
}

export async function connectDatabase(): Promise<DatabaseStatus> {
  registerConnectionListeners();

  const uri = getValidatedMongoUri();
  if (!uri) {
    const raw = (process.env.MONGODB_URI || '').trim();
    if (raw.length > 0 && !/^mongodb(\+srv)?:\/\//i.test(raw)) {
      lastSanitizedError = 'MONGODB_URI format must start with mongodb:// or mongodb+srv://';
      console.warn(`⚠️ [MongoDB] ${lastSanitizedError}`);
    } else if (raw.includes('<db_password>') || raw.includes('<password>')) {
      lastSanitizedError = 'MONGODB_URI still contains placeholder <db_password>. Replace it in server/.env.';
      console.warn(`⚠️ [MongoDB] ${lastSanitizedError}`);
    } else {
      lastSanitizedError = undefined;
      console.log('🗄️ [MongoDB] Skipped startup connection (MONGODB_URI not set in server/.env).');
    }
    return getDatabaseStatus();
  }

  if (mongoose.connection.readyState === 1) {
    return getDatabaseStatus();
  }

  if (inFlightConnection) {
    return inFlightConnection;
  }

  inFlightConnection = (async () => {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
        maxPoolSize: 10,
      });
      lastSanitizedError = undefined;
    } catch (err: any) {
      lastSanitizedError = sanitizeMongoMessage(err?.message || 'Failed to connect to MongoDB Atlas.');
      console.warn(`⚠️ [MongoDB] Connection failed: ${lastSanitizedError}`);
    } finally {
      inFlightConnection = null;
    }
    return getDatabaseStatus();
  })();

  return inFlightConnection;
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
