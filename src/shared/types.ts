export interface DictionaryEntry {
  id?: number;
  wrong_reading: string;
  correct_text: string;
  source: 'manual' | 'gmail' | 'learned';
  frequency: number;
  created_at?: string;
}

export interface AppConfig {
  hotkey: string;
  whisperModelPath: string;
  gmailRefreshToken?: string;
  language: string;
}

export type AppMode = 'faithful'; // 将来: | 'polished'

export interface TranscriptionResult {
  raw: string;
  corrected: string;
  mode: AppMode;
}
