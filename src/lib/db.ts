import { openDB, IDBPDatabase } from 'idb';

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

const DB_NAME = 'fintrack_db';
const DB_VERSION = 1;

let _db: IDBPDatabase<any> | null = null;

async function getDB(): Promise<IDBPDatabase<any>> {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('user')) {
        db.createObjectStore('user', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('transactions')) {
        db.createObjectStore('transactions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('insights')) {
        db.createObjectStore('insights', { keyPath: 'id' });
      }
    },
  });
  return _db;
}

// ── USER ──
export async function saveUser(profile: UserProfile): Promise<void> {
  const db = await getDB();
  await db.put('user', profile);
}

export async function getUser(): Promise<UserProfile | null> {
  const db = await getDB();
  const all = await db.getAll('user');
  return all[0] ?? null;
}

// ── TRANSACTIONS ──
export async function saveTransactions(txs: Transaction[]): Promise<void> {
  const db = await getDB();
  const store = db.transaction('transactions', 'readwrite').objectStore('transactions');
  for (const tx of txs) {
    await store.put(tx);
  }
}

export async function getAllTransactions(): Promise<Transaction[]> {
  const db = await getDB();
  return db.getAll('transactions');
}

export async function clearTransactions(): Promise<void> {
  const db = await getDB();
  await db.clear('transactions');
}

// ── INSIGHTS ──
export async function saveInsight(insight: MonthlyInsight): Promise<void> {
  const db = await getDB();
  await db.put('insights', insight);
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
  ]);
}
