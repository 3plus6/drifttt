import * as fs from 'fs';
import * as path from 'path';
import { getAppDataPath } from '../shared/constants';

interface Config {
  hotkey: string;
  openaiApiKey: string;
  soundEnabled: boolean;
  soundPreset: string;
  soundVolume: number;
  backgroundMute: boolean;
  appPrompts: Record<string, string>;
  pttKey: string;            // 'right-cmd' | 'left-cmd' | 'right-ctrl' | 'right-shift' | 'right-alt' | 'fn'
  cleanupAddonKey: string;   // PTT押下中にこのキーを追加で押すと整理モード。'minus'|'equal'|'slash'|'quote'|'semicolon'|'none'
  cleanupKey: string;        // [非推奨]
  cleanupModifier: string;   // [非推奨]
  setupAcknowledged: boolean; // 初期設定完了後に実際に再起動を済ませた
  pendingRestartAck: boolean; // 再起動ボタンがクリックされた（次の起動で acknowledged=true へ）
  setupCompletedAt: number;  // [非推奨]
  appLaunchedAt: number;     // [非推奨]
  configSchemaVersion: number; // 古い設定を一度だけリセットするためのマイグレーション用
  basePrompt: string;       // 'standard' | 'business' | 'casual'
  recognitionMode: string;  // 'cloud' | 'local'
  cloudTranscribeModel: string; // 'mini' | 'high'
  localModel: string;       // 'base' | 'small-q4' | 'small-q5' | 'small' | 'medium-q4' | 'medium-q5' | 'kotoba-v2-q4' | 'large-q4' | 'large-q5' | 'large-full'
  gptPostProcess: string;   // 'off' | 'dict-only' | 'always' | 'cleanup'
  reviewBeforeInsert: boolean; // 認識結果を確認・修正してから入力する
  autoLearnCorrections: boolean; // 修正差分を補正辞書候補として学習する
  totalChars: number;
  totalWords: number;
  totalAudioSeconds: number;
  totalTranscriptions: number;
  monthlyStatsKey: string;
  monthlyChars: number;
  monthlyWords: number;
  monthlyAudioSeconds: number;
  monthlyTranscriptions: number;
  supportPromptLastThresholdHours: number;
  supportPromptLastShownAt: number;
  supporterCode: string;
  supporterCodeAcceptedAt: number;
  updateLastCheckAt: number;
  updatePromptSnoozedVersion: string;
  updatePromptSnoozedAt: number;
}

interface HistoryEntry {
  text: string;
  timestamp: number;
  elapsedMs?: number;
}

const DEFAULT_CONFIG: Config = {
  hotkey: 'CommandOrControl+;',
  openaiApiKey: '',
  soundEnabled: true,
  soundPreset: '5',
  soundVolume: 75,
  backgroundMute: false,
  appPrompts: {},
  pttKey: 'right-cmd',
  cleanupAddonKey: 'underscore',
  cleanupKey: 'none',
  cleanupModifier: 'none',
  setupAcknowledged: false,
  pendingRestartAck: false,
  setupCompletedAt: 0,
  appLaunchedAt: 0,
  configSchemaVersion: 0,
  basePrompt: 'standard',
  recognitionMode: 'cloud',
  cloudTranscribeModel: 'mini',
  localModel: 'small-q4',
  gptPostProcess: 'off',
  reviewBeforeInsert: false,
  autoLearnCorrections: true,
  totalChars: 0,
  totalWords: 0,
  totalAudioSeconds: 0,
  totalTranscriptions: 0,
  monthlyStatsKey: '',
  monthlyChars: 0,
  monthlyWords: 0,
  monthlyAudioSeconds: 0,
  monthlyTranscriptions: 0,
  supportPromptLastThresholdHours: 0,
  supportPromptLastShownAt: 0,
  supporterCode: '',
  supporterCodeAcceptedAt: 0,
  updateLastCheckAt: 0,
  updatePromptSnoozedVersion: '',
  updatePromptSnoozedAt: 0,
};

export class ConfigManager {
  private configPath: string;
  private historyPath: string;
  private config: Config;

  constructor() {
    this.configPath = path.join(getAppDataPath(), 'config.json');
    this.historyPath = path.join(getAppDataPath(), 'history.json');
    this.config = this.load();
  }

  private load(): Config {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      }
    } catch {}
    return { ...DEFAULT_CONFIG };
  }

  save(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }

  set<K extends keyof Config>(key: K, value: Config[K]): void {
    (this.config as any)[key] = value;
    this.save();
  }

  getAll(): Config {
    return { ...this.config };
  }

  private getCurrentMonthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private ensureMonthlyStats(): void {
    const currentKey = this.getCurrentMonthKey();
    if (this.config.monthlyStatsKey !== currentKey) {
      this.config.monthlyStatsKey = currentKey;
      this.config.monthlyChars = 0;
      this.config.monthlyWords = 0;
      this.config.monthlyAudioSeconds = 0;
      this.config.monthlyTranscriptions = 0;
    }
  }

  // 統計
  addStats(wordCount: number, audioSeconds = 0, charCount = 0): void {
    this.ensureMonthlyStats();
    this.config.totalWords += wordCount;
    this.config.totalChars += Math.max(0, charCount);
    this.config.totalAudioSeconds += Math.max(0, audioSeconds);
    this.config.totalTranscriptions += 1;
    this.config.monthlyWords += wordCount;
    this.config.monthlyChars += Math.max(0, charCount);
    this.config.monthlyAudioSeconds += Math.max(0, audioSeconds);
    this.config.monthlyTranscriptions += 1;
    this.save();
  }

  getStats(): Pick<Config, 'totalChars' | 'totalWords' | 'totalAudioSeconds' | 'totalTranscriptions' | 'monthlyStatsKey' | 'monthlyChars' | 'monthlyWords' | 'monthlyAudioSeconds' | 'monthlyTranscriptions'> {
    this.ensureMonthlyStats();
    this.save();
    return {
      totalChars: this.config.totalChars,
      totalWords: this.config.totalWords,
      totalAudioSeconds: this.config.totalAudioSeconds,
      totalTranscriptions: this.config.totalTranscriptions,
      monthlyStatsKey: this.config.monthlyStatsKey,
      monthlyChars: this.config.monthlyChars,
      monthlyWords: this.config.monthlyWords,
      monthlyAudioSeconds: this.config.monthlyAudioSeconds,
      monthlyTranscriptions: this.config.monthlyTranscriptions,
    };
  }

  // 履歴
  getHistory(): HistoryEntry[] {
    try {
      if (fs.existsSync(this.historyPath)) {
        return JSON.parse(fs.readFileSync(this.historyPath, 'utf-8'));
      }
    } catch {}
    return [];
  }

  addHistory(text: string, elapsedMs?: number): void {
    const history = this.getHistory();
    history.unshift({ text, timestamp: Date.now(), elapsedMs });
    // 最新5件のみ保持
    const trimmed = history.slice(0, 5);
    fs.writeFileSync(this.historyPath, JSON.stringify(trimmed, null, 2));
  }
}
