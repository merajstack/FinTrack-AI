import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type AIProvider = 'gemini' | 'nvidia' | 'groq';

export interface UserProfile {
  id: string;
  name: string;
  age: number;
  monthlyIncome: number;
  savingsGoal: number;
  investmentGoal: number;
  geminiKey: string;
  aiProvider: AIProvider;
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  createdAt: string;
  email: string;
  emailVerified: boolean;
  passwordHash?: string;           // SHA-256 hex of the user's password
  biometricCredentialId?: string;  // Base64 WebAuthn credential ID
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;         // positive = income, negative = expense
  category: string;
  type: 'income' | 'expense';
  isFlagged?: boolean;    // fraud flag
}

export interface MonthlyInsight {
  id: string; // "YYYY-MM"
  totalIncome: number;
  totalExpense: number;
  savingsRate: number;
  healthScore: number;
  categoryBreakdown: Record<string, number>;
  recommendations: string;
  fraudFlags: string[];
}

export interface StoredChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface ChatSession {
  id: string;
  messages: StoredChatMessage[];
  updatedAt: string;
}

const DB_NAME = 'fintrack_db';
const DB_VERSION = 2;
const DB_SYNC_CHANNEL = 'fintrack-db-sync';
const DB_SYNC_STORAGE_KEY = 'fintrack_db_sync';
const APP_STORAGE_PREFIX = 'fintrack_';

export interface DbChangeEvent {
  scope: 'user' | 'transactions' | 'insights' | 'chats' | 'all';
  timestamp: number;
  source: string;
}

type DbChangeListener = (event: DbChangeEvent) => void;

const dbChangeListeners = new Set<DbChangeListener>();
let dbSyncChannel: BroadcastChannel | null = null;
let dbSyncReady = false;
let lastDbEventTimestamp = 0;

function createDbEvent(scope: DbChangeEvent['scope']): DbChangeEvent {
  return {
    scope,
    timestamp: Date.now(),
    source: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
  };
}

function notifyDbChange(event: DbChangeEvent, shouldBroadcast = true): void {
  lastDbEventTimestamp = Math.max(lastDbEventTimestamp, event.timestamp);

  for (const listener of dbChangeListeners) {
    listener(event);
  }

  if (!shouldBroadcast || typeof window === 'undefined') return;

  if ('BroadcastChannel' in window) {
    if (!dbSyncChannel) {
      dbSyncChannel = new BroadcastChannel(DB_SYNC_CHANNEL);
    }
    dbSyncChannel.postMessage(event);
    return;
  }

  try {
    localStorage.setItem(DB_SYNC_STORAGE_KEY, JSON.stringify(event));
    localStorage.removeItem(DB_SYNC_STORAGE_KEY);
  } catch {
    // Ignore storage quota / privacy mode failures.
  }
}

function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== DB_SYNC_STORAGE_KEY || !event.newValue) return;

  try {
    const payload = JSON.parse(event.newValue) as DbChangeEvent;
    if (!payload || payload.timestamp <= lastDbEventTimestamp) return;
    notifyDbChange(payload, false);
  } catch {
    // Ignore malformed sync payloads.
  }
}

function ensureDbSync(): void {
  if (typeof window === 'undefined' || dbSyncReady) return;

  dbSyncReady = true;
  window.addEventListener('storage', handleStorageEvent);

  if ('BroadcastChannel' in window) {
    dbSyncChannel = new BroadcastChannel(DB_SYNC_CHANNEL);
    dbSyncChannel.onmessage = (message) => {
      const payload = message.data as DbChangeEvent;
      if (!payload || payload.timestamp <= lastDbEventTimestamp) return;
      notifyDbChange(payload, false);
    };
  }
}

export function subscribeToDbChanges(listener: DbChangeListener): () => void {
  if (typeof window !== 'undefined') {
    ensureDbSync();
  }

  dbChangeListeners.add(listener);
  return () => {
    dbChangeListeners.delete(listener);
  };
}

function emitDbChange(scope: DbChangeEvent['scope']): void {
  if (typeof window === 'undefined') return;
  notifyDbChange(createDbEvent(scope));
}

interface FintrackDB extends DBSchema {
  user: {
    key: string;
    value: UserProfile;
  };
  transactions: {
    key: string;
    value: Transaction;
  };
  insights: {
    key: string;
    value: MonthlyInsight;
  };
  chats: {
    key: string;
    value: ChatSession;
  };
}

let _db: IDBPDatabase<FintrackDB> | null = null;

async function getDB(): Promise<IDBPDatabase<FintrackDB>> {
  if (_db) {
    if (!_db.objectStoreNames.contains('chats')) {
      _db.close();
      _db = null;
    } else {
      return _db;
    }
  }

  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains('user')) {
        db.createObjectStore('user', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('transactions')) {
        db.createObjectStore('transactions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('insights')) {
        db.createObjectStore('insights', { keyPath: 'id' });
      }
      if (oldVersion < 2 && !db.objectStoreNames.contains('chats')) {
        db.createObjectStore('chats', { keyPath: 'id' });
      }
    },
  });
  return _db;
}

function clearAppLocalStorage(): void {
  if (typeof window === 'undefined') return;

  const keysToRemove = Object.keys(localStorage).filter((key) => key === 'fintrack_session' || key.startsWith(APP_STORAGE_PREFIX));
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}

// ── USER ──
export async function saveUser(profile: UserProfile): Promise<void> {
  const db = await getDB();
  await db.put('user', profile);
  emitDbChange('user');
}

export async function getUser(): Promise<UserProfile | null> {
  try {
    const db = await getDB();
    const all = await db.getAll('user');
    return all[0] ?? null;
  } catch {
    return null;
  }
}

// ── TRANSACTIONS ──
export async function saveTransactions(txs: Transaction[]): Promise<void> {
  const db = await getDB();
  const store = db.transaction('transactions', 'readwrite').objectStore('transactions');
  for (const tx of txs) {
    await store.put(tx);
  }
  emitDbChange('transactions');
}

export async function getAllTransactions(): Promise<Transaction[]> {
  const db = await getDB();
  return db.getAll('transactions');
}

export async function clearTransactions(): Promise<void> {
  const db = await getDB();
  await db.clear('transactions');
  emitDbChange('transactions');
}

// ── INSIGHTS ──
export async function saveInsight(insight: MonthlyInsight): Promise<void> {
  const db = await getDB();
  await db.put('insights', insight);
  emitDbChange('insights');
}

export async function getAllInsights(): Promise<MonthlyInsight[]> {
  const db = await getDB();
  return db.getAll('insights');
}

// ── UTILS ──
export async function clearAllData(): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.clear('user'),
    db.clear('transactions'),
    db.clear('insights'),
    db.clear('chats'),
  ]);
  clearAppLocalStorage();
  emitDbChange('all');
}

// ── CHAT SESSIONS ──
export async function saveChatMessages(sessionId: string, messages: StoredChatMessage[]): Promise<void> {
  const db = await getDB();
  await db.put('chats', {
    id: sessionId,
    messages,
    updatedAt: new Date().toISOString(),
  });
  emitDbChange('chats');
}

export async function getChatMessages(sessionId: string): Promise<StoredChatMessage[]> {
  const db = await getDB();
  const session = await db.get('chats', sessionId);
  return session?.messages ?? [];
}

export async function clearChatMessages(sessionId: string): Promise<void> {
  const db = await getDB();
  await db.delete('chats', sessionId);
  emitDbChange('chats');
}
