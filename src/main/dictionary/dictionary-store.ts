import Database from 'better-sqlite3';
import { getDbPath } from '../../shared/constants';
import { DictionaryEntry } from '../../shared/types';

export interface CorrectionCandidate {
  id?: number;
  wrong_reading: string;
  correct_text: string;
  frequency: number;
  status: 'pending' | 'promoted' | 'ignored';
  created_at?: string;
  updated_at?: string;
}

export class DictionaryStore {
  private db: Database.Database;

  constructor() {
    this.db = new Database(getDbPath());
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dictionary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wrong_reading TEXT NOT NULL,
        correct_text TEXT NOT NULL,
        source TEXT DEFAULT 'manual',
        frequency INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_wrong_reading ON dictionary(wrong_reading);

      CREATE TABLE IF NOT EXISTS correction_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wrong_reading TEXT NOT NULL,
        correct_text TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(wrong_reading, correct_text)
      );
      CREATE INDEX IF NOT EXISTS idx_correction_candidates_status ON correction_candidates(status);
    `);
  }

  getAll(): DictionaryEntry[] {
    return this.db.prepare('SELECT * FROM dictionary ORDER BY frequency DESC').all() as DictionaryEntry[];
  }

  add(entry: Omit<DictionaryEntry, 'id' | 'created_at'>): void {
    const existing = this.db.prepare(
      'SELECT id FROM dictionary WHERE wrong_reading = ? AND correct_text = ?'
    ).get(entry.wrong_reading, entry.correct_text);

    if (existing) {
      this.db.prepare(
        'UPDATE dictionary SET frequency = frequency + 1 WHERE wrong_reading = ? AND correct_text = ?'
      ).run(entry.wrong_reading, entry.correct_text);
    } else {
      this.db.prepare(
        'INSERT INTO dictionary (wrong_reading, correct_text, source, frequency) VALUES (?, ?, ?, ?)'
      ).run(entry.wrong_reading, entry.correct_text, entry.source, entry.frequency);
    }
  }

  getCandidates(): CorrectionCandidate[] {
    return this.db.prepare(
      'SELECT * FROM correction_candidates WHERE status = ? ORDER BY frequency DESC, updated_at DESC'
    ).all('pending') as CorrectionCandidate[];
  }

  recordCorrectionCandidate(wrongReading: string, correctText: string): { frequency: number; promoted: boolean } {
    const wrong = wrongReading.trim();
    const correct = correctText.trim();
    if (!wrong || !correct || wrong === correct) return { frequency: 0, promoted: false };

    const existingDict = this.db.prepare(
      'SELECT id, frequency FROM dictionary WHERE wrong_reading = ? AND correct_text = ?'
    ).get(wrong, correct) as { id: number; frequency: number } | undefined;
    if (existingDict) {
      this.db.prepare('UPDATE dictionary SET frequency = frequency + 1 WHERE id = ?').run(existingDict.id);
      return { frequency: existingDict.frequency + 1, promoted: false };
    }

    const existingCandidate = this.db.prepare(
      'SELECT id, frequency FROM correction_candidates WHERE wrong_reading = ? AND correct_text = ?'
    ).get(wrong, correct) as { id: number; frequency: number } | undefined;

    const frequency = existingCandidate ? existingCandidate.frequency + 1 : 1;
    if (existingCandidate) {
      this.db.prepare(
        'UPDATE correction_candidates SET frequency = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(frequency, 'pending', existingCandidate.id);
    } else {
      this.db.prepare(
        'INSERT INTO correction_candidates (wrong_reading, correct_text, frequency, status) VALUES (?, ?, ?, ?)'
      ).run(wrong, correct, frequency, 'pending');
    }

    if (frequency >= 2) {
      this.add({ wrong_reading: wrong, correct_text: correct, source: 'learned', frequency });
      this.db.prepare(
        'UPDATE correction_candidates SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE wrong_reading = ? AND correct_text = ?'
      ).run('promoted', wrong, correct);
      return { frequency, promoted: true };
    }

    return { frequency, promoted: false };
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM dictionary WHERE id = ?').run(id);
  }

  update(id: number, entry: Partial<DictionaryEntry>): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (entry.wrong_reading !== undefined) {
      fields.push('wrong_reading = ?');
      values.push(entry.wrong_reading);
    }
    if (entry.correct_text !== undefined) {
      fields.push('correct_text = ?');
      values.push(entry.correct_text);
    }

    if (fields.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE dictionary SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }
  }

  close(): void {
    this.db.close();
  }
}
