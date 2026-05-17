import {
  app,
  Tray,
  Menu,
  globalShortcut,
  nativeImage,
  systemPreferences,
  BrowserWindow,
  ipcMain,
  Notification,
  clipboard,
  shell,
} from 'electron';
import { spawn, execSync, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import { AudioRecorder } from './audio-recorder';
import { WhisperEngine } from './whisper-engine';
import { TextInjector } from './text-injector';
import { DictionaryStore } from './dictionary/dictionary-store';
import { ConfigManager } from './config';
import { getAppDataPath, getModelPath } from '../shared/constants';

// インメモリログバッファ（アプリ内のログタブで表示）
const MAX_LOG_LINES = 500;
const logBuffer: string[] = [];
function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  logBuffer.push(line);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
  console.log(msg);
}

// リソースパス解決（パッケージ版/開発版両対応）
function getResourcePath(...parts: string[]): string {
  const packaged = path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', ...parts);
  const dev = path.join(__dirname, '..', '..', 'resources', ...parts);
  return fs.existsSync(packaged) ? packaged : dev;
}

// 音を再生（プリセット・音量対応）
function playStartSound(): void {
  try {
    const preset = config.get('soundPreset') || '5';
    const volume = (config.get('soundVolume') || 75) / 100;
    const soundPath = getResourcePath('sounds', `${preset}_start.wav`);
    spawn('afplay', ['-v', String(volume * 2), soundPath], { stdio: 'ignore' });
  } catch {}
}

function playEndSound(): void {
  try {
    const preset = config.get('soundPreset') || '5';
    const volume = (config.get('soundVolume') || 75) / 100;
    const soundPath = getResourcePath('sounds', `${preset}_end.wav`);
    spawn('afplay', ['-v', String(volume * 2), soundPath], { stdio: 'ignore' });
  } catch {}
}

// BGオーディオミュート
let wasMuted = false;
function muteSystemAudio(): void {
  try {
    const vol = execSync('osascript -e "output muted of (get volume settings)"', { encoding: 'utf-8' }).trim();
    wasMuted = vol === 'true';
    if (!wasMuted) execSync('osascript -e "set volume with output muted"');
  } catch {}
}

function unmuteSystemAudio(): void {
  try {
    if (!wasMuted) execSync('osascript -e "set volume without output muted"');
  } catch {}
}


// アクティブアプリ名を取得
function getActiveAppName(): string {
  try {
    return execSync(
      'osascript -e \'tell application "System Events" to get name of first application process whose frontmost is true\'',
      { encoding: 'utf-8', timeout: 2000 }
    ).trim();
  } catch {
    return '';
  }
}

function activateApp(appName: string): void {
  if (!appName) return;
  try {
    execSync(`osascript -e 'tell application ${JSON.stringify(appName)} to activate'`, { timeout: 2000 });
  } catch (error: any) {
    debugLog(`[AppContext] アプリ復帰失敗: ${appName} ${error.message}`);
  }
}

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let recorder: AudioRecorder;
let whisper: WhisperEngine;
let injector: TextInjector;
let dictStore: DictionaryStore;
let config: ConfigManager;
const INITIAL_SUPPORT_THRESHOLDS_HOURS = [1, 3, 6, 12];
const SUPPORT_THRESHOLD_STEP_HOURS = 12;
const SUPPORT_PROMPT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const SUPPORTER_CODES = new Set(['DRIFTTT-THANKS-2026', 'DRIFTTT-KYUU-2026']);
const UPDATE_CHECK_URL = 'https://3plus6.jp/drifttt/latest.json';
const UPDATE_CHECK_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
const UPDATE_CHECK_POLL_MS = 6 * 60 * 60 * 1000;
const UPDATE_PROMPT_SNOOZE_MS = 24 * 60 * 60 * 1000;

function ensureDataDir(): void {
  const dataDir = getAppDataPath();
  const modelsDir = path.join(dataDir, 'models');
  for (const dir of [dataDir, modelsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

async function requestMicrophonePermission(): Promise<boolean> {
  const status = systemPreferences.getMediaAccessStatus('microphone');
  debugLog(`[Mic] status=${status}`);
  if (status === 'granted') return true;
  if (status === 'denied') {
    new Notification({
      title: 'drifttt',
      body: 'マイク権限が拒否されています。システム設定 → プライバシーとセキュリティ → マイク で許可してください。',
    }).show();
    return false;
  }
  // not-determined: ダイアログを表示
  const granted = await systemPreferences.askForMediaAccess('microphone');
  debugLog(`[Mic] askForMediaAccess result=${granted}`);
  return granted;
}

function createTray(): void {
  const iconPath = getResourcePath('tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('drifttt - Write at the speed of thought.');
  updateTrayMenu(false);
}

function updateTrayMenu(isRecording: boolean): void {
  if (!tray) return;
  const stats = config.getAll();
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: isRecording ? '録音中...' : 'drifttt', enabled: false },
    { type: 'separator' },
    { label: `${stats.totalWords?.toLocaleString() || 0} ワード認識`, enabled: false },
    { type: 'separator' },
    { label: '設定...', click: () => openSettings() },
    { label: '履歴...', click: () => openSettings('history') },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function openSettings(tab?: string): void {
  if (settingsWindow) {
    settingsWindow.focus();
    if (tab) settingsWindow.webContents.send('switch-tab', tab);
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 640,
    title: 'drifttt',
    resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });

  if (tab) {
    settingsWindow.webContents.once('did-finish-load', () => {
      settingsWindow?.webContents.send('switch-tab', tab);
    });
  }
}

function ensureSettingsWindow(): Promise<BrowserWindow> {
  openSettings();
  const target = settingsWindow!;
  target.focus();
  return new Promise(resolve => {
    if (!target.webContents.isLoading()) {
      resolve(target);
      return;
    }
    target.webContents.once('did-finish-load', () => resolve(target));
  });
}

function estimateSavedMinutes(chars: number, audioSeconds: number): number {
  const estimatedTypingMinutes = (chars || 0) / 120;
  const actualSpeakingMinutes = (audioSeconds || 0) / 60;
  return Math.max(0, estimatedTypingMinutes - actualSpeakingMinutes);
}

function normalizeSupporterCode(code: string): string {
  return String(code || '').trim().toUpperCase();
}

function isSupporterCodeValid(code: string): boolean {
  return SUPPORTER_CODES.has(normalizeSupporterCode(code));
}

function getSupportThresholdForSavedHours(savedHours: number, lastThreshold: number): number | null {
  if (savedHours < 1) return null;
  const crossed = INITIAL_SUPPORT_THRESHOLDS_HOURS.filter(hours => hours > lastThreshold && savedHours >= hours);
  if (savedHours >= 24) {
    const latestSteppedThreshold = Math.floor(savedHours / SUPPORT_THRESHOLD_STEP_HOURS) * SUPPORT_THRESHOLD_STEP_HOURS;
    if (latestSteppedThreshold >= 24 && latestSteppedThreshold > lastThreshold) crossed.push(latestSteppedThreshold);
  }
  if (crossed.length === 0) return null;
  return Math.max(...crossed);
}

function sendToSettingsWhenReady(channel: string, payload: any): void {
  void ensureSettingsWindow().then((target) => {
    const send = () => target.webContents.send(channel, payload);
    if (target.webContents.isLoading()) {
      target.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  });
}

function maybePromptSupport(): void {
  if (!config) return;
  if (isSupporterCodeValid(config.get('supporterCode') || '')) return;
  const stats = config.getStats();
  const savedMinutes = estimateSavedMinutes(stats.totalChars || 0, stats.totalAudioSeconds || 0);
  const savedHours = savedMinutes / 60;
  const lastThreshold = Number(config.get('supportPromptLastThresholdHours') || 0);
  const threshold = getSupportThresholdForSavedHours(savedHours, lastThreshold);
  if (!threshold) return;
  const lastShownAt = Number(config.get('supportPromptLastShownAt') || 0);
  if (lastShownAt > 0 && Date.now() - lastShownAt < SUPPORT_PROMPT_COOLDOWN_MS) return;

  config.set('supportPromptLastShownAt', Date.now());

  sendToSettingsWhenReady('show-support-prompt', {
    thresholdHours: threshold,
    savedHours,
  });
}

function compareVersions(a: string, b: string): number {
  const normalize = (value: string) => String(value || '').replace(/^v/i, '').split(/[.-]/).map(part => parseInt(part, 10) || 0);
  const left = normalize(a);
  const right = normalize(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, (res) => {
      if ((res.statusCode || 0) >= 300 && res.headers.location) {
        res.resume();
        fetchJson(new URL(res.headers.location, url).toString()).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function checkForUpdates(manual = false): Promise<{ updateAvailable: boolean; latest?: any; error?: string }> {
  const now = Date.now();
  if (!manual && now - Number(config.get('updateLastCheckAt') || 0) < UPDATE_CHECK_INTERVAL_MS) {
    return { updateAvailable: false };
  }

  try {
    config.set('updateLastCheckAt', now);
    const latest = await fetchJson(UPDATE_CHECK_URL);
    const latestVersion = String(latest.version || latest.latestVersion || '').replace(/^v/i, '');
    if (!latestVersion || compareVersions(latestVersion, app.getVersion()) <= 0) {
      return { updateAvailable: false, latest };
    }

    const snoozedVersion = config.get('updatePromptSnoozedVersion') || '';
    const snoozedAt = Number(config.get('updatePromptSnoozedAt') || 0);
    const snoozed = !manual && snoozedVersion === latestVersion && now - snoozedAt < UPDATE_PROMPT_SNOOZE_MS;
    if (!snoozed) {
      sendToSettingsWhenReady('show-update-prompt', {
        currentVersion: app.getVersion(),
        latestVersion,
        title: latest.title || `drifttt v${latestVersion} が公開されています`,
        message: latest.message || latest.notes || '安定性の改善と不具合修正を含みます。',
        downloadUrl: latest.downloadUrl || latest.url || latest.releaseUrl || 'https://3plus6.jp/support.html',
      });
    }
    return { updateAvailable: true, latest };
  } catch (error: any) {
    if (String(error.message || '').includes('HTTP 404')) {
      return { updateAvailable: false };
    }
    debugLog(`[Update] 確認失敗: ${error.message}`);
    return { updateAvailable: false, error: error.message };
  }
}

function startUpdateChecker(): void {
  setTimeout(() => {
    void checkForUpdates(false);
  }, 2500);

  setInterval(() => {
    void checkForUpdates(false);
  }, UPDATE_CHECK_POLL_MS);
}

// フローティングステータス
function showFloatingStatus(mode: 'recording' | 'processing' | 'recording-cleanup' | 'processing-cleanup'): void {
  const { screen } = require('electron');
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

  if (!floatingWindow) {
    floatingWindow = new BrowserWindow({
      width: 200,
      height: 36,
      x: dx + Math.round(dw / 2 - 100),
      y: dy + dh - 60,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      resizable: false,
      focusable: false,
      type: 'panel',
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });

    floatingWindow.setIgnoreMouseEvents(true);
    floatingWindow.setVisibleOnAllWorkspaces(true);
    floatingWindow.loadFile(path.join(__dirname, '..', 'renderer', 'floating-status.html'));
    floatingWindow.on('closed', () => { floatingWindow = null; });
  } else {
    floatingWindow.setPosition(dx + Math.round(dw / 2 - 100), dy + dh - 60);
  }

  floatingWindow.webContents.on('did-finish-load', () => {
    floatingWindow?.webContents.send('set-status', mode);
  });
  if (!floatingWindow.webContents.isLoading()) {
    floatingWindow.webContents.send('set-status', mode);
  }
  floatingWindow.showInactive();
}

function hideFloatingStatus(): void {
  if (floatingWindow) {
    floatingWindow.close();
    floatingWindow = null;
  }
}

type CorrectionEditorResult = { action: 'copy' | 'cancel'; text: string };

async function openCorrectionEditor(originalText: string): Promise<CorrectionEditorResult> {
  const target = await ensureSettingsWindow();
  return new Promise((resolve) => {
    const cleanup = (result: CorrectionEditorResult) => {
      ipcMain.removeListener('correction-review-result', onResult);
      target.removeListener('closed', onClosed);
      resolve(result);
    };

    const onResult = (_event: Electron.IpcMainEvent, result: CorrectionEditorResult) => {
      cleanup({
        action: result?.action || 'cancel',
        text: typeof result?.text === 'string' ? result.text : originalText,
      });
    };

    const onClosed = () => cleanup({ action: 'cancel', text: originalText });

    ipcMain.once('correction-review-result', onResult);
    target.once('closed', onClosed);
    target.webContents.send('open-correction-review', originalText);
  });
}

function normalizeCorrectionPart(text: string): string {
  return text
    .replace(/^[\s、。,.!！?？「」『』（）()]+|[\s、。,.!！?？「」『』（）()]+$/g, '')
    .trim();
}

function extractCorrectionPairs(originalText: string, revisedText: string): Array<{ wrong: string; correct: string }> {
  const original = originalText.trim();
  const revised = revisedText.trim();
  if (!original || !revised || original === revised) return [];
  if (original.length > 1600 || revised.length > 1600) return [];

  const a = Array.from(original);
  const b = Array.from(revised);
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const edits: Array<{ type: 'equal' | 'delete' | 'insert'; value: string }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      edits.push({ type: 'equal', value: a[i] });
      i += 1;
      j += 1;
    } else if (i < a.length && (j === b.length || dp[i + 1][j] >= dp[i][j + 1])) {
      edits.push({ type: 'delete', value: a[i++] });
    } else if (j < b.length) {
      edits.push({ type: 'insert', value: b[j++] });
    }
  }

  const pairs: Array<{ wrong: string; correct: string }> = [];
  const addPair = (deletedText: string, insertedText: string) => {
    const wrong = normalizeCorrectionPart(deletedText);
    const correct = normalizeCorrectionPart(insertedText);
    if (!wrong || !correct || wrong === correct) return;
    if (wrong.length < 2 || correct.length < 2 || wrong.length > 18 || correct.length > 28) return;
    if (!/[ぁ-んァ-ン一-龥A-Za-z0-9]/.test(wrong) || !/[ぁ-んァ-ン一-龥A-Za-z0-9]/.test(correct)) return;
    pairs.push({ wrong, correct });
  };

  for (let index = 0; index < edits.length; index++) {
    if (edits[index].type === 'equal') continue;

    let deleted = '';
    let inserted = '';
    const runStart = index;
    while (index < edits.length && edits[index].type !== 'equal') {
      if (edits[index].type === 'delete') deleted += edits[index].value;
      if (edits[index].type === 'insert') inserted += edits[index].value;
      index += 1;
    }
    index -= 1;

    addPair(deleted, inserted);

    const rawWrong = normalizeCorrectionPart(deleted);
    const rawCorrect = normalizeCorrectionPart(inserted);
    if (rawWrong.length < 2 || rawCorrect.length < 2) {
      const rightContextSize = rawCorrect.length === 1 && rawWrong.length > 1 ? 2 : 1;
      const leftContext = edits
        .slice(Math.max(0, runStart - 1), runStart)
        .filter(edit => edit.type === 'equal')
        .map(edit => edit.value)
        .join('');
      const rightContext = edits
        .slice(index + 1, index + 1 + rightContextSize)
        .filter(edit => edit.type === 'equal')
        .map(edit => edit.value)
        .join('');
      addPair(`${leftContext}${deleted}${rightContext}`, `${leftContext}${inserted}${rightContext}`);
    }
  }

  const seen = new Set<string>();
  return pairs.filter(pair => {
    const key = `${pair.wrong}\u0000${pair.correct}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function learnCorrectionPairs(originalText: string, revisedText: string): void {
  if (!config.get('autoLearnCorrections')) return;
  const pairs = extractCorrectionPairs(originalText, revisedText);
  if (pairs.length === 0) return;

  let promotedCount = 0;
  for (const pair of pairs) {
    const result = dictStore.recordCorrectionCandidate(pair.wrong, pair.correct);
    if (result.promoted) promotedCount += 1;
    debugLog(`[学習候補] "${pair.wrong}" → "${pair.correct}" frequency=${result.frequency}${result.promoted ? ' promoted' : ''}`);
  }
  if (promotedCount > 0) {
    updateWhisperHints();
    if (settingsWindow) settingsWindow.webContents.send('dictionary-updated');
  }
}


// Whisperヒント更新
function updateWhisperHints(): void {
  const hints: string[] = [];
  if (dictStore) {
    const entries = dictStore.getAll();
    for (const e of entries) {
      if (e.wrong_reading !== e.correct_text) hints.push(e.correct_text);
    }
    whisper.setDictContext(
      entries
        .filter(e => e.wrong_reading !== e.correct_text)
        .map(e => ({ wrong: e.wrong_reading, correct: e.correct_text }))
    );
  }
  if (whisper) whisper.setPromptHints(hints);
}

let recordingTimer: NodeJS.Timeout | null = null;
const MAX_RECORDING_SEC = 120;
let isProcessing = false;

function isRecoverableRecordingError(error: any): boolean {
  const message = String(error?.message || error || '');
  return (
    message.includes('録音停止がタイムアウトしました') ||
    message.includes('録音中ではありません') ||
    message.includes('ENOENT') ||
    message.includes('no such file or directory')
  );
}

function analyzeRecordedWav(audioPath: string): { durationMs: number; rms: number; peak: number; activeRatio: number } {
  const buffer = fs.readFileSync(audioPath);
  const dataOffset = buffer.length > 44 ? 44 : 0;
  const sampleCount = Math.floor((buffer.length - dataOffset) / 2);
  if (sampleCount <= 0) return { durationMs: 0, rms: 0, peak: 0, activeRatio: 0 };

  let sumSquares = 0;
  let peak = 0;
  let activeSamples = 0;
  const activeThreshold = 0.012;

  for (let offset = dataOffset; offset + 1 < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset) / 32768;
    const abs = Math.abs(sample);
    sumSquares += sample * sample;
    if (abs > peak) peak = abs;
    if (abs > activeThreshold) activeSamples += 1;
  }

  return {
    durationMs: Math.round((sampleCount / 16000) * 1000),
    rms: Math.sqrt(sumSquares / sampleCount),
    peak,
    activeRatio: activeSamples / sampleCount,
  };
}

function shouldSkipRecordedAudio(audioPath: string, audioSize: number): string | null {
  if (audioSize < 5000) return '録音が短すぎるためスキップ';

  const metrics = analyzeRecordedWav(audioPath);
  debugLog(
    `[AudioCheck] duration=${metrics.durationMs}ms rms=${metrics.rms.toFixed(4)} peak=${metrics.peak.toFixed(4)} active=${metrics.activeRatio.toFixed(3)}`
  );

  if (metrics.durationMs < 600) return '録音が短すぎるためスキップ';
  if (metrics.rms < 0.006 && metrics.peak < 0.04) return '声が入っていないためスキップ';
  if (metrics.activeRatio < 0.015 && metrics.rms < 0.012) return '声が入っていないためスキップ';
  return null;
}

async function handleRecordingToggle(): Promise<void> {
  if (isProcessing) {
    debugLog('[drifttt] 処理中のため録音開始を無視');
    return;
  }
  if (recorder.getIsRecording()) {
    await stopAndTranscribe();
  } else {
    await recorder.startRecording();
    updateTrayMenu(true);
    showFloatingStatus('recording');
    recordingTimer = setTimeout(async () => {
      if (recorder.getIsRecording()) await stopAndTranscribe();
    }, MAX_RECORDING_SEC * 1000);
  }
}

async function stopAndTranscribe(modeOverride?: string): Promise<void> {
  if (isProcessing) {
    debugLog('[drifttt] 処理中のためstopAndTranscribeを無視');
    return;
  }
  isProcessing = true;
  if (recordingTimer) { clearTimeout(recordingTimer); recordingTimer = null; }
  updateTrayMenu(false);
  showFloatingStatus(modeOverride === 'cleanup' ? 'processing-cleanup' : 'processing');

  try {
    if (config.get('backgroundMute')) unmuteSystemAudio();

    debugLog('[stopAndTranscribe] 録音停止中...');
    const recordingMs = recorder.getCurrentRecordingMs();
    const audioPath = await recorder.stopRecording();
    const audioExists = !!audioPath && fs.existsSync(audioPath);
    const audioSize = audioExists ? fs.statSync(audioPath).size : 0;
    debugLog(`[stopAndTranscribe] audioPath=${audioPath} size=${audioExists ? audioSize : 'missing'}`);

    if (!audioExists) {
      debugLog('[drifttt] 録音ファイルが存在しないためスキップ');
      return;
    }

    const skipReason = shouldSkipRecordedAudio(audioPath, audioSize);
    if (skipReason) {
      debugLog(`[drifttt] ${skipReason}`);
      fs.unlinkSync(audioPath);
      return;
    }

    // アプリ別プロンプト切り替え
    const appName = getActiveAppName();
    const appPrompts = config.get('appPrompts') || {};
    const appPrompt = appPrompts[appName] || '';
    whisper.setAppContext(appName, appPrompt);
    if (appPrompt) debugLog(`[AppContext] ${appName}: ${appPrompt}`);

    const recognitionMode = config.get('recognitionMode') || 'cloud';
    const recognitionLabel = recognitionMode === 'cloud'
      ? `cloud:${config.get('cloudTranscribeModel') || 'mini'}`
      : `local:${config.get('localModel') || 'small-q4'}`;
    debugLog(`[stopAndTranscribe] 音声認識中... (${recognitionLabel})`);
    const result = await whisper.transcribe(audioPath, modeOverride);
    const text = result.text;
    const elapsedMs = result.elapsedMs;
    debugLog(`[stopAndTranscribe] 結果: ${text.slice(0, 50)} (${elapsedMs}ms)`);

    // PDCA用ログ: モデル、処理時間、ワード数を記録
    const wordCount = text.trim() ? text.split(/[\s、。！？]+/).filter(w => w.length > 0).length : 0;
    const charCount = text.replace(/\s/g, '').length;
    debugLog(`[PDCA] model=${recognitionLabel} | mode=${modeOverride || config.get('gptPostProcess') || 'off'} | ${elapsedMs}ms | ${wordCount}words | ${charCount}chars | "${text.trim().slice(0, 50)}"`);

    if (text.trim()) {
      if (config.get('soundEnabled')) playEndSound();
      let finalText = text;
      let shouldInsert = !config.get('reviewBeforeInsert');
      if (config.get('reviewBeforeInsert')) {
        hideFloatingStatus();
        const edited = await openCorrectionEditor(text);
        if (edited.action === 'cancel') {
          debugLog('[stopAndTranscribe] 確認入力をキャンセル');
          return;
        }
        finalText = edited.text.trim();
        learnCorrectionPairs(text, finalText);
        clipboard.writeText(finalText);
        debugLog('[stopAndTranscribe] 修正後テキストをコピー');
      }

      if (shouldInsert && finalText) {
        debugLog('[stopAndTranscribe] テキスト入力中...');
        // PTTキーのKeyUp直後や通知音の直後にUnicode入力を投げると、
        // 一部アプリで修飾キー状態が残ったまま扱われて入力が弾かれることがある。
        await new Promise(resolve => setTimeout(resolve, 180));
        await injector.inject(finalText);
        debugLog('[stopAndTranscribe] テキスト入力完了');
      }
      const finalWordCount = finalText.trim() ? finalText.split(/[\s、。！？]+/).filter(w => w.length > 0).length : 0;
      const finalCharCount = finalText.replace(/\s/g, '').length;
      config.addStats(finalWordCount, recordingMs / 1000, finalCharCount);
      config.addHistory(finalText, elapsedMs);
      updateTrayMenu(false);
      maybePromptSupport();
    }

    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  } catch (error: any) {
    debugLog(`[drifttt] エラー: ${error.message}`);
    if (isRecoverableRecordingError(error)) {
      debugLog('[drifttt] 録音まわりの一時エラーとして通知せず復旧');
      return;
    }
    new Notification({ title: 'drifttt', body: `エラー: ${error.message}` }).show();
  } finally {
    isProcessing = false;
    hideFloatingStatus();
  }
}

function fixBinaryPermissions(): void {
  // パッケージ版でバイナリの実行権限と検疫属性を修正
  const binaries = ['key-listener', 'text-typer', 'apple-speech'];
  for (const bin of binaries) {
    const packaged = path.join(process.resourcesPath, bin);
    if (fs.existsSync(packaged)) {
      try {
        fs.chmodSync(packaged, 0o755);
        execSync(`xattr -cr "${packaged}"`, { timeout: 3000 });
        debugLog(`[drifttt] ${bin} 権限修正完了`);
      } catch (e: any) {
        debugLog(`[drifttt] ${bin} 権限修正失敗: ${e.message}`);
      }
    }
  }
}

// uiohookキーコードのマッピング
// uiohook-napiの実際のキーコード（左側=scancode、右側=extended形式）
const PTT_KEYCODE_MAP: Record<string, number> = {
  'right-cmd': 3676,   // MetaRight
  'left-cmd': 3675,    // Meta
  'right-ctrl': 3613,  // CtrlRight
  'left-ctrl': 29,     // Ctrl
  'right-shift': 54,   // ShiftRight
  'left-shift': 42,    // Shift
  'right-alt': 3640,   // AltRight
  'left-alt': 56,      // Alt
  'fn': 0,             // Fnキーはuiohookでは検知不可
};

// 整理モードのアドオンキー（PTT押下中にこれが押されたら整理モード）
const ADDON_KEYCODE_MAP: Record<string, number> = {
  'underscore': 115, // JIS「ろ」キー（\ / _）※日本語配列専用。Shift不要
  'minus': 12,       // - / _（US配列）
  'equal': 13,       // = / +
  'slash': 53,       // / / ?
  'quote': 40,       // ' / "
  'semicolon': 39,   // ; / :
  'none': -1,
};

// Shift必須キー（Cmd+単独押下だとブラウザのズーム等と衝突するため）
// JISの「ろ」キー(115)はそもそも物理的に _ を出すキーなのでShift不要
const ADDON_REQUIRES_SHIFT: Record<string, boolean> = {
  'underscore': false,
  'minus': true,
  'equal': true,
  'slash': true,
  'quote': true,
  'semicolon': true,
};

let cleanupAddonLatched = false;
let pttIsDown = false;
let pttChordCancelled = false;
let shiftIsDown = false;
const SHIFT_KEYCODES = [42, 54];
let keyListenerReady = false;

function registerHotkey(): void {
  const pttKey = config.get('pttKey') || 'right-cmd';
  const addonKey = config.get('cleanupAddonKey') || 'underscore';
  const pttKeycode = PTT_KEYCODE_MAP[pttKey] ?? 3676;
  const addonKeycode = ADDON_KEYCODE_MAP[addonKey] ?? -1;
  const requiresShift = ADDON_REQUIRES_SHIFT[addonKey] ?? true;

  // uiohook-napi: Electronプロセス内でキー検知（アプリ自体の権限で動く）
  try {
    const { uIOhook } = require('uiohook-napi');
    keyListenerReady = false;
    // 以前のリスナーをクリア（再設定時に重複しないように）
    uIOhook.removeAllListeners('keydown');
    uIOhook.removeAllListeners('keyup');
    // 状態もリセット
    pttIsDown = false;
    pttChordCancelled = false;
    cleanupAddonLatched = false;
    shiftIsDown = false;

    uIOhook.on('keydown', (e: any) => {
      // Shift状態を追跡
      if (SHIFT_KEYCODES.includes(e.keycode)) shiftIsDown = true;
      // PTT押下中の全キーをログ出力（整理モードのキー特定用）
      if (pttIsDown && e.keycode !== pttKeycode) {
        debugLog(`[uiohook] KEY during PTT: keycode=${e.keycode} shift=${shiftIsDown} (addon target=${addonKeycode})`);
      }
      // PTT押下中にアドオンキーが押されたらComposeモードフラグを立てる（ラッチ）
      // requiresShiftがtrueのキーはShift併用を要求（Cmd+- のズーム衝突回避）
      if (pttIsDown && e.keycode === addonKeycode && (!requiresShift || shiftIsDown)) {
        cleanupAddonLatched = true;
        activeCleanup = true;
        debugLog(`[uiohook] CLEANUP ADDON pressed (${addonKey}${requiresShift ? ' + Shift' : ''})`);
        // フローティング表示を整理モード録音中に切り替え
        if (floatingWindow) {
          floatingWindow.webContents.send('set-status', 'recording-cleanup');
        }
        return;
      }
      if (pttIsDown && e.keycode !== pttKeycode && !SHIFT_KEYCODES.includes(e.keycode)) {
        pttChordCancelled = true;
        debugLog(`[drifttt] PTT中に別キーを検知したため録音をキャンセル: keycode=${e.keycode}`);
        if (pendingRecordingStart) {
          clearTimeout(pendingRecordingStart);
          pendingRecordingStart = null;
          hideFloatingStatus();
          updateTrayMenu(false);
          return;
        }
        if (recorder?.getIsRecording()) {
          void cancelActiveRecording('ショートカット操作を検知');
        }
        return;
      }
      if (e.keycode === pttKeycode) {
        // 安全策: pttIsDownが残っていても、実際に録音中でなければリセット
        if (pttIsDown && !recorder?.getIsRecording()) {
          debugLog('[uiohook] pttIsDown残留をリセット');
          pttIsDown = false;
        }
        if (!pttIsDown) {
          pttIsDown = true;
          pttChordCancelled = false;
          cleanupAddonLatched = false;
          debugLog(`[uiohook] KEY_DOWN PTT (${pttKey})`);
          handleKeyDown(false);
        }
      }
    });

    uIOhook.on('keyup', (e: any) => {
      if (SHIFT_KEYCODES.includes(e.keycode)) shiftIsDown = false;
      if (e.keycode === pttKeycode && pttIsDown) {
        pttIsDown = false;
        const isCleanup = cleanupAddonLatched;
        debugLog(`[uiohook] KEY_UP PTT (${pttKey}) cleanup=${isCleanup}`);
        handleKeyUp(isCleanup);
      }
    });

    uIOhook.start();
    keyListenerReady = true;
    debugLog(`[drifttt] uiohookキーリスナー起動（PTT: ${pttKey}、整理アドオン: ${addonKey}）`);
  } catch (err: any) {
    debugLog(`[drifttt] uiohook起動失敗: ${err.message}`);
    keyListenerReady = false;
    if (String(err.message || '').includes('assistive devices')) {
      debugLog('[drifttt] アクセシビリティ権限が未許可のためキーリスナーを停止中');
      globalShortcut.unregisterAll();
      return;
    }
    // フォールバック: globalShortcutのトグルモード
    const hotkey = config.get('hotkey');
    globalShortcut.register(hotkey, handleRecordingToggle);
    keyListenerReady = globalShortcut.isRegistered(hotkey);
    debugLog('[drifttt] フォールバック: ホットキー登録: ' + hotkey);
  }
}

let keyDownTime = 0;
let activeCleanup = false;
const RECORDING_START_DELAY_MS = 120; // Commandショートカットかどうかだけ短く待つ
const MIN_RECORDING_HOLD_MS = 300; // 0.3秒未満の押しは誤タップとして無視
let pendingRecordingStart: NodeJS.Timeout | null = null;
let isCancellingRecording = false;

async function cancelActiveRecording(reason: string): Promise<void> {
  if (isCancellingRecording) return;
  isCancellingRecording = true;
  if (recordingTimer) { clearTimeout(recordingTimer); recordingTimer = null; }
  if (pendingRecordingStart) {
    clearTimeout(pendingRecordingStart);
    pendingRecordingStart = null;
  }
  try {
    debugLog(`[drifttt] 録音キャンセル: ${reason}`);
    if (recorder.getIsRecording()) {
      await recorder.cancelRecording();
    }
  } catch (error: any) {
    debugLog(`[drifttt] 録音キャンセル中のエラーを無視: ${error.message}`);
  } finally {
    if (config.get('backgroundMute')) unmuteSystemAudio();
    hideFloatingStatus();
    updateTrayMenu(false);
    isCancellingRecording = false;
  }
}

async function handleKeyDown(isCleanup: boolean): Promise<void> {
  if (isProcessing || recorder.getIsRecording() || pendingRecordingStart) {
    if (isProcessing) debugLog('[drifttt] 処理中のためキー押下を無視');
    return;
  }
  keyDownTime = Date.now();
  activeCleanup = isCleanup;
  pendingRecordingStart = setTimeout(async () => {
    pendingRecordingStart = null;
    if (!pttIsDown || pttChordCancelled || recorder.getIsRecording()) return;
    if (config.get('soundEnabled')) playStartSound();
    if (config.get('backgroundMute')) muteSystemAudio();
    await recorder.startRecording();
    updateTrayMenu(true);
    showFloatingStatus(activeCleanup ? 'recording-cleanup' : 'recording');
    recordingTimer = setTimeout(async () => {
      if (!recorder.getIsRecording()) return;
      if (pttIsDown) {
        debugLog('[drifttt] 最大録音時間に到達。キーを離すまで入力処理を待機');
        return;
      }
      await stopAndTranscribe(activeCleanup ? 'cleanup' : undefined);
    }, MAX_RECORDING_SEC * 1000);
  }, RECORDING_START_DELAY_MS);
}

async function handleKeyUp(isCleanup: boolean): Promise<void> {
  if (pttChordCancelled) {
    debugLog('[drifttt] ショートカット操作として扱い、録音処理を破棄');
    pttChordCancelled = false;
    if (pendingRecordingStart) {
      clearTimeout(pendingRecordingStart);
      pendingRecordingStart = null;
    }
    if (recorder.getIsRecording()) {
      await cancelActiveRecording('ショートカット操作の終了');
    } else {
      hideFloatingStatus();
      updateTrayMenu(false);
    }
    return;
  }
  if (isProcessing && !recorder.getIsRecording()) {
    debugLog('[drifttt] 処理中のためキー離しを無視');
    return;
  }
  if (pendingRecordingStart) {
    clearTimeout(pendingRecordingStart);
    pendingRecordingStart = null;
    debugLog(`[drifttt] 短押し無視 (${Date.now() - keyDownTime}ms)`);
    hideFloatingStatus();
    updateTrayMenu(false);
    return;
  }
  if (!recorder.getIsRecording()) return;
  const held = Date.now() - keyDownTime;
  if (held < MIN_RECORDING_HOLD_MS) {
    debugLog(`[drifttt] 誤タップ無視 (${held}ms)`);
    try { await recorder.cancelRecording(); } catch {}
    if (config.get('backgroundMute')) unmuteSystemAudio();
    hideFloatingStatus();
    updateTrayMenu(false);
    return;
  }
  const modeOverride = isCleanup ? 'cleanup' : undefined;
  if (isCleanup) debugLog('[drifttt] Composeモード発動');
  await stopAndTranscribe(modeOverride);
}

// IPC
function setupIPC(): void {
  ipcMain.handle('get-config', () => config.getAll());
  ipcMain.handle('set-config', (_event, key: string, value: any) => {
    config.set(key as any, value);
    if (key === 'hotkey' || key === 'pttKey' || key === 'cleanupAddonKey') {
      // キーリスナーを再起動
      try { require('uiohook-napi').uIOhook.stop(); } catch {}
      globalShortcut.unregisterAll();
      registerHotkey();
    }
    if (key === 'openaiApiKey' && whisper) whisper.setApiKey(value);
    if (key === 'recognitionMode' && whisper) whisper.setRecognitionMode(value);
    if (key === 'cloudTranscribeModel' && whisper) whisper.setCloudTranscribeModel(value);
    if (key === 'basePrompt' && whisper) whisper.setBasePrompt(value);
    if (key === 'localModel' && whisper) whisper.setLocalModel(value);
    if (key === 'gptPostProcess' && whisper) whisper.setGptPostProcess(value);
  });

  ipcMain.handle('get-dictionary', () => dictStore.getAll());
  ipcMain.handle('get-correction-candidates', () => dictStore.getCandidates());
  ipcMain.handle('add-dictionary', (_event, wrongReading: string, correctText: string) => {
    dictStore.add({ wrong_reading: wrongReading, correct_text: correctText, source: 'manual', frequency: 1 });
    updateWhisperHints();
  });
  ipcMain.handle('remove-dictionary', (_event, id: number) => {
    dictStore.remove(id);
    updateWhisperHints();
  });

  ipcMain.handle('get-history', () => config.getHistory());
  ipcMain.handle('get-stats', () => config.getStats());

  ipcMain.handle('get-app-prompts', () => config.get('appPrompts') || {});
  ipcMain.handle('get-active-app-name', () => getActiveAppName());
  ipcMain.handle('set-app-prompt', (_event, appName: string, prompt: string) => {
    const prompts = config.get('appPrompts') || {};
    if (prompt.trim()) {
      prompts[appName] = prompt.trim();
    } else {
      delete prompts[appName];
    }
    config.set('appPrompts', prompts);
  });

  ipcMain.handle('preview-sound', (_event, preset: string, volume: number) => {
    const vol = (volume || 75) / 100;
    const startPath = getResourcePath('sounds', `${preset}_start.wav`);
    const endPath = getResourcePath('sounds', `${preset}_end.wav`);
    spawn('afplay', ['-v', String(vol * 2), startPath], { stdio: 'ignore' });
    setTimeout(() => {
      spawn('afplay', ['-v', String(vol * 2), endPath], { stdio: 'ignore' });
    }, 400);
  });

  ipcMain.handle('restart-app', () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('mic-permission-granted', () => {
    debugLog('[Mic] レンダラーからマイク権限取得通知');
  });

  // 権限ステータス
  ipcMain.handle('get-permission-status', () => {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    let accessibilityOk = false;
    try {
      accessibilityOk = systemPreferences.isTrustedAccessibilityClient(false);
    } catch {}
    return {
      microphone: micStatus,
      accessibility: accessibilityOk,
      keyListenerReady,
    };
  });

  ipcMain.handle('get-local-engine-status', () => ({
    available: whisper?.isModelAvailable() || false,
  }));

  // ログ
  ipcMain.handle('get-logs', () => logBuffer.join('\n'));
  ipcMain.handle('clear-logs', () => { logBuffer.length = 0; });

  ipcMain.handle('dismiss-support-prompt', (_event, thresholdHours: number) => {
    const threshold = Math.max(0, Number(thresholdHours) || 0);
    config.set('supportPromptLastShownAt', Date.now());
    if (threshold > Number(config.get('supportPromptLastThresholdHours') || 0)) {
      config.set('supportPromptLastThresholdHours', threshold);
    }
  });

  ipcMain.handle('open-support-url', (_event, thresholdHours?: number) => {
    const threshold = Math.max(0, Number(thresholdHours) || 0);
    config.set('supportPromptLastShownAt', Date.now());
    if (threshold > Number(config.get('supportPromptLastThresholdHours') || 0)) {
      config.set('supportPromptLastThresholdHours', threshold);
    }
    shell.openExternal('https://3plus6.jp/support.html');
  });

  ipcMain.handle('save-supporter-code', (_event, code: string) => {
    const normalizedCode = normalizeSupporterCode(code);
    if (!normalizedCode) {
      config.set('supporterCode', '');
      config.set('supporterCodeAcceptedAt', 0);
      return { ok: true, cleared: true };
    }
    if (!isSupporterCodeValid(normalizedCode)) {
      return { ok: false };
    }
    config.set('supporterCode', normalizedCode);
    config.set('supporterCodeAcceptedAt', Date.now());
    return { ok: true };
  });

  ipcMain.handle('check-for-updates', (_event, manual = false) => checkForUpdates(!!manual));

  ipcMain.handle('snooze-update-prompt', (_event, version: string) => {
    config.set('updatePromptSnoozedVersion', String(version || ''));
    config.set('updatePromptSnoozedAt', Date.now());
  });

  ipcMain.handle('open-update-url', (_event, version: string, url: string) => {
    config.set('updatePromptSnoozedVersion', String(version || ''));
    config.set('updatePromptSnoozedAt', Date.now());
    shell.openExternal(url || 'https://3plus6.jp/support.html');
  });
}

app.on('ready', async () => {
  try {
    ensureDataDir();
    fixBinaryPermissions();
    config = new ConfigManager();
    // 設定スキーマのマイグレーション: 初回のみ古いsetupAcknowledgedをクリア
    const CURRENT_SCHEMA = 8;
    const configSchema = config.get('configSchemaVersion') || 0;
    if (configSchema < 3) {
      config.set('setupAcknowledged', false);
      config.set('pendingRestartAck', false);
      // v3: JIS配列対応のためcleanupAddonKeyをunderscoreにリセット
      config.set('cleanupAddonKey', 'underscore');
      debugLog('[drifttt] 設定マイグレーション: setupAcknowledgedをリセット');
    }
    if (configSchema < 4 && config.get('localModel') === 'small') {
      // v4: 実測結果に基づき、既定をより軽いsmall-q4へ移行
      config.set('localModel', 'small-q4');
      debugLog('[drifttt] 設定マイグレーション: localModel=small-q4');
    }
    if (configSchema < 5) {
      config.set('recognitionMode', 'cloud');
      config.set('setupAcknowledged', false);
      config.set('pendingRestartAck', false);
      debugLog('[drifttt] 設定マイグレーション: recognitionMode=cloud');
    }
    if (configSchema < 6) {
      config.set('gptPostProcess', 'off');
      debugLog('[drifttt] 設定マイグレーション: gptPostProcess=off');
    }
    if (configSchema < 7 && (!config.get('soundPreset') || config.get('soundPreset') === '1')) {
      config.set('soundPreset', '5');
      debugLog('[drifttt] 設定マイグレーション: soundPreset=5');
    }
    if (configSchema < 8) {
      config.set('reviewBeforeInsert', false);
      debugLog('[drifttt] 設定マイグレーション: reviewBeforeInsert=false');
    }
    if (configSchema < CURRENT_SCHEMA) {
      config.set('configSchemaVersion', CURRENT_SCHEMA);
    }
    // 再起動ボタンがクリックされ、実際にアプリが再起動されたことを検知
    if (config.get('pendingRestartAck')) {
      config.set('setupAcknowledged', true);
      config.set('pendingRestartAck', false);
      debugLog('[drifttt] 再起動完了 → setupAcknowledged=true');
    }

    try {
      dictStore = new DictionaryStore();

      const vocabPath = path.join(getAppDataPath(), 'gmail-vocabulary.json');
      if (fs.existsSync(vocabPath)) {
        const vocab = JSON.parse(fs.readFileSync(vocabPath, 'utf-8'));
        for (const entry of vocab) {
          dictStore.add({ wrong_reading: entry.wrong, correct_text: entry.correct, source: 'gmail', frequency: 1 });
        }
      }
      debugLog(`[drifttt] 辞書: ${dictStore.getAll().length}件`);
    } catch (dbError: any) {
      debugLog(`[drifttt] 辞書エラー: ${dbError.message}`);
    }

    whisper = new WhisperEngine();
    const apiKey = config.get('openaiApiKey');
    if (apiKey) whisper.setApiKey(apiKey);
    whisper.setRecognitionMode(config.get('recognitionMode') || 'cloud');
    whisper.setCloudTranscribeModel(config.get('cloudTranscribeModel') || 'mini');
    whisper.setBasePrompt(config.get('basePrompt') || 'standard');
    whisper.setLocalModel(config.get('localModel') || 'small-q4');
    whisper.setGptPostProcess(config.get('gptPostProcess') || 'off');
    updateWhisperHints();

    injector = new TextInjector();
    recorder = new AudioRecorder();
    await recorder.init();

    createTray();
    registerHotkey();
    setupIPC();
    // 先にウィンドウを開いて前面に出す
    openSettings();
    // ウィンドウ表示が落ち着いてから権限ダイアログを出す（ダイアログが裏に隠れないように）
    setTimeout(async () => {
      try {
        if (settingsWindow) {
          settingsWindow.focus();
          if (app.dock) app.dock.show();
        }
        await requestMicrophonePermission();
      } catch (e: any) {
        debugLog(`[Mic] 権限リクエストエラー: ${e.message}`);
      }
    }, 800);
    debugLog('[drifttt] 起動完了');
    debugLog(`[drifttt] app.isPackaged=${app.isPackaged} resourcesPath=${process.resourcesPath}`);
    setTimeout(() => {
      maybePromptSupport();
    }, 2500);
    startUpdateChecker();
  } catch (error: any) {
    debugLog(`[drifttt] 起動エラー: ${error.message}`);
    try { openSettings(); } catch {}
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { require('uiohook-napi').uIOhook.stop(); } catch {}
  recorder?.destroy();
  dictStore?.close();
});

app.on('window-all-closed', () => {});

// Dockアイコンクリックで設定ウィンドウを再表示
app.on('activate', () => {
  openSettings();
});
