import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class TextInjector {
  private typerPath: string;

  constructor() {
    const packaged = path.join(process.resourcesPath, 'text-typer');
    const dev = path.join(__dirname, '..', '..', 'resources', 'text-typer');
    this.typerPath = fs.existsSync(packaged) ? packaged : dev;
  }

  async inject(text: string): Promise<void> {
    // CGEvents で直接テキスト入力（クリップボード不使用）
    return new Promise<void>((resolve, reject) => {
      let stdoutBuf = '';
      let stderrBuf = '';
      const child = execFile(this.typerPath, [], { timeout: 5000 }, (error, stdout, stderr) => {
        stdoutBuf = stdout || '';
        stderrBuf = stderr || '';
        if (error) {
          console.log(`[text-typer] エラー: ${error.message} stderr=${stderrBuf}`);
          reject(new Error(`テキスト入力に失敗しました: ${error.message}`));
          return;
        }
        if (stderrBuf) console.log(`[text-typer] stderr: ${stderrBuf}`);
        if (stdoutBuf) console.log(`[text-typer] stdout: ${stdoutBuf}`);
        console.log(`[text-typer] ${text.length}文字を入力 (exit=${child.exitCode})`);
        resolve();
      });
      child.stdin?.write(text);
      child.stdin?.end();
    });
  }
}
