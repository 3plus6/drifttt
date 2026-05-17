import * as path from 'path';
import { app } from 'electron';

export const APP_NAME = 'drifttt';
export const DEFAULT_HOTKEY = 'CommandOrControl+;';
export const WHISPER_LANGUAGE = 'ja';
export const WHISPER_MODEL_NAME = 'ggml-large-v3-turbo.bin';

export function getAppDataPath(): string {
  return path.join(app.getPath('userData'));
}

export function getModelPath(): string {
  return path.join(getAppDataPath(), 'models', WHISPER_MODEL_NAME);
}

export function getDbPath(): string {
  return path.join(getAppDataPath(), 'dictionary.sqlite');
}
