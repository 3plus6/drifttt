import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class AudioRecorder {
  private hiddenWindow: BrowserWindow | null = null;
  private isRecording = false;
  private startedAt = 0;
  private rendererReady: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    this.hiddenWindow = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    const recorderHtml = path.join(__dirname, '..', 'renderer', 'recorder.html');
    console.log(`[Recorder] HTML path: ${recorderHtml} exists=${fs.existsSync(recorderHtml)}`);
    await this.hiddenWindow.loadFile(recorderHtml);
    this.rendererReady = Promise.resolve();
    console.log('[Recorder] HTML loaded');

    ipcMain.handle('get-temp-path', () => {
      return path.join(os.tmpdir(), `drifttt-${Date.now()}.wav`);
    });
  }

  async startRecording(): Promise<void> {
    if (!this.hiddenWindow || this.isRecording) return;
    await this.waitForRendererReady();
    if (!this.hiddenWindow || this.isRecording) return;
    this.isRecording = true;
    this.startedAt = Date.now();
    console.log('[Recorder] start-recording sent');
    this.hiddenWindow.webContents.send('start-recording');
  }

  private waitForRendererReady(): Promise<void> {
    return Promise.race([
      this.rendererReady,
      new Promise<void>(resolve => setTimeout(resolve, 3000)),
    ]);
  }

  private reloadRecorder(): void {
    if (!this.hiddenWindow || this.hiddenWindow.isDestroyed()) return;

    const webContents = this.hiddenWindow.webContents;
    this.rendererReady = new Promise(resolve => {
      let settled = false;
      let fallbackTimer: NodeJS.Timeout | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        webContents.removeListener('did-finish-load', finish);
        webContents.removeListener('did-fail-load', finish);
        console.log('[Recorder] HTML reloaded');
        resolve();
      };
      webContents.once('did-finish-load', finish);
      webContents.once('did-fail-load', finish);
      fallbackTimer = setTimeout(finish, 3000);
    });

    try {
      webContents.send('cancel-recording');
      webContents.reload();
    } catch {
      this.rendererReady = Promise.resolve();
    }
  }

  getCurrentRecordingMs(): number {
    return this.startedAt ? Math.max(0, Date.now() - this.startedAt) : 0;
  }

  async stopRecording(): Promise<string> {
    if (!this.hiddenWindow || !this.isRecording) {
      throw new Error('録音中ではありません');
    }
    this.isRecording = false;

    return new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timeout);
        ipcMain.removeListener('recording-complete', onComplete);
        ipcMain.removeListener('recording-error', onError);
      };

      const onComplete = (_event: Electron.IpcMainEvent, filePath: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        console.log(`[Recorder] complete: ${filePath}`);
        this.reloadRecorder();
        resolve(filePath);
      };

      const onError = (_event: Electron.IpcMainEvent, error: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        console.log(`[Recorder] error: ${error}`);
        this.reloadRecorder();
        reject(new Error(error));
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        console.log('[Recorder] TIMEOUT: 10秒経過、応答なし');
        try { this.hiddenWindow!.webContents.send('cancel-recording'); } catch {}
        this.reloadRecorder();
        reject(new Error('録音停止がタイムアウトしました'));
      }, 10000);

      ipcMain.once('recording-complete', onComplete);
      ipcMain.once('recording-error', onError);

      console.log('[Recorder] stop-recording sent');
      this.hiddenWindow!.webContents.send('stop-recording');
    });
  }

  async cancelRecording(): Promise<void> {
    if (!this.hiddenWindow || this.hiddenWindow.isDestroyed()) {
      this.isRecording = false;
      this.startedAt = 0;
      return;
    }

    this.isRecording = false;
    this.startedAt = 0;

    await new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ipcMain.removeListener('recording-cancelled', onCancelled);
        resolve();
      };
      const onCancelled = () => finish();
      const timeout = setTimeout(finish, 1000);
      ipcMain.once('recording-cancelled', onCancelled);
      try {
        console.log('[Recorder] cancel-recording sent');
        this.hiddenWindow!.webContents.send('cancel-recording');
      } catch {
        finish();
      }
    });

    this.reloadRecorder();
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }

  destroy(): void {
    if (this.hiddenWindow) {
      this.hiddenWindow.destroy();
      this.hiddenWindow = null;
    }
  }
}
