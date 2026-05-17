#!/usr/bin/env node
/**
 * Whisperモデルをダウンロードするスクリプト
 * 使い方: node scripts/download-model.js [出力ディレクトリ]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin';
const DEFAULT_DIR = path.join(__dirname, '..', 'resources', 'models');

async function download(outputDir) {
  const dir = outputDir || DEFAULT_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const outputPath = path.join(dir, 'ggml-large-v3-turbo.bin');

  if (fs.existsSync(outputPath)) {
    console.log('モデルは既にダウンロード済みです:', outputPath);
    return outputPath;
  }

  console.log('Whisperモデルをダウンロード中...');
  console.log('URL:', MODEL_URL);
  console.log('保存先:', outputPath);

  return new Promise((resolve, reject) => {
    function doRequest(url) {
      https.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          doRequest(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`ダウンロード失敗: HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloaded = 0;
        const file = fs.createWriteStream(outputPath);

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          file.write(chunk);
          if (totalSize) {
            const pct = ((downloaded / totalSize) * 100).toFixed(1);
            const mb = (downloaded / 1024 / 1024).toFixed(0);
            const totalMb = (totalSize / 1024 / 1024).toFixed(0);
            process.stdout.write(`\r  ${pct}% (${mb}MB / ${totalMb}MB)`);
          }
        });

        response.on('end', () => {
          file.end();
          console.log('\nダウンロード完了:', outputPath);
          resolve(outputPath);
        });

        response.on('error', (err) => {
          file.end();
          fs.unlinkSync(outputPath);
          reject(err);
        });
      }).on('error', reject);
    }

    doRequest(MODEL_URL);
  });
}

if (require.main === module) {
  download(process.argv[2]).catch((err) => {
    console.error('エラー:', err.message);
    process.exit(1);
  });
}

module.exports = { download };
