import { DictionaryStore } from './dictionary-store';
import { DictionaryEntry } from '../../shared/types';

export class DictionaryApplier {
  private store: DictionaryStore;
  private cache: DictionaryEntry[] = [];

  constructor(store: DictionaryStore) {
    this.store = store;
    this.refreshCache();
  }

  refreshCache(): void {
    this.cache = this.store.getAll();
  }

  apply(text: string): string {
    let result = text;

    // wrong_reading !== correct_text のエントリのみ適用（同値は意味がない）
    for (const entry of this.cache) {
      if (entry.wrong_reading !== entry.correct_text && result.includes(entry.wrong_reading)) {
        result = result.replaceAll(entry.wrong_reading, entry.correct_text);
        console.log(`[辞書] "${entry.wrong_reading}" → "${entry.correct_text}"`);
      }
    }

    return result;
  }
}
