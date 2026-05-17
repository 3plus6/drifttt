import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { DictionaryStore } from '../dictionary/dictionary-store';

export class EmailParser {
  private gmail: gmail_v1.Gmail;
  private store: DictionaryStore;

  constructor(authClient: OAuth2Client, store: DictionaryStore) {
    this.gmail = google.gmail({ version: 'v1', auth: authClient });
    this.store = store;
  }

  async extractVocabulary(): Promise<{ word: string; source: string }[]> {
    const extracted: { word: string; source: string }[] = [];

    const res = await this.gmail.users.messages.list({
      userId: 'me',
      q: 'category:social',
      maxResults: 100,
    });

    const messages = res.data.messages || [];

    for (const msg of messages) {
      const detail = await this.gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject'],
      });

      const headers = detail.data.payload?.headers || [];

      const fromHeader = headers.find(h => h.name === 'From');
      if (fromHeader?.value) {
        const names = this.extractNamesFromHeader(fromHeader.value);
        names.forEach(name => extracted.push({ word: name, source: 'gmail-from' }));
      }

      const subjectHeader = headers.find(h => h.name === 'Subject');
      if (subjectHeader?.value) {
        const terms = this.extractJapaneseTerms(subjectHeader.value);
        terms.forEach(term => extracted.push({ word: term, source: 'gmail-subject' }));
      }
    }

    const unique = this.deduplicate(extracted);
    return unique;
  }

  private extractNamesFromHeader(from: string): string[] {
    const names: string[] = [];
    const match = from.match(/^(.+?)\s*<.+>$/);
    if (match) {
      const name = match[1].replace(/["']/g, '').trim();
      if (name && this.containsJapanese(name)) {
        names.push(name);
      }
    }
    return names;
  }

  private extractJapaneseTerms(text: string): string[] {
    const terms: string[] = [];

    // カタカナ語を抽出（3文字以上）
    const katakanaMatches = text.match(/[\u30A0-\u30FF]{3,}/g) || [];
    terms.push(...katakanaMatches);

    // 漢字を含む固有名詞的な語句（2文字以上の漢字列）
    const kanjiMatches = text.match(/[\u4E00-\u9FFF]{2,}/g) || [];
    terms.push(...kanjiMatches);

    return terms;
  }

  private containsJapanese(text: string): boolean {
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text);
  }

  private deduplicate(items: { word: string; source: string }[]): { word: string; source: string }[] {
    const seen = new Set<string>();
    return items.filter(item => {
      if (seen.has(item.word)) return false;
      seen.add(item.word);
      return true;
    });
  }

  addToDict(words: string[]): void {
    for (const word of words) {
      this.store.add({
        wrong_reading: this.toHiragana(word),
        correct_text: word,
        source: 'gmail',
        frequency: 1,
      });
    }
  }

  private toHiragana(text: string): string {
    // カタカナをひらがなに変換（簡易版）
    return text.replace(/[\u30A1-\u30F6]/g, (match) => {
      return String.fromCharCode(match.charCodeAt(0) - 0x60);
    });
  }
}
