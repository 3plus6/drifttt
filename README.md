# drifttt

drifttt is a macOS voice input app that uses your own OpenAI API key.

driftttは、OpenAI APIキーを自分で設定して使うMac向け音声入力アプリです。

The app itself is distributed for free. OpenAI API usage fees are charged directly to the user's own OpenAI account.

アプリ本体は無料で配布しています。音声認識APIの利用料金は、利用者自身のOpenAIアカウントに直接発生します。

## Download / ダウンロード

Download the latest DMG from GitHub Releases.

最新版はGitHub Releasesからダウンロードできます。

https://github.com/3plus6/drifttt/releases

## Install / インストール

1. Download `drifttt-1.0.0-arm64.dmg` from GitHub Releases.
2. Open the downloaded DMG file.
3. Drag `drifttt.app` into the `Applications` folder.
4. After the copy is complete, you can close the DMG window.

---

1. GitHub Releasesから `drifttt-1.0.0-arm64.dmg` をダウンロードします。
2. ダウンロードしたDMGファイルを開きます。
3. `drifttt.app` を `Applications` フォルダにドラッグします。
4. コピーが完了したら、DMGウィンドウは閉じて大丈夫です。

## First Launch / 初回起動

Because this is a GitHub-distributed build, macOS may show a security confirmation on first launch.

GitHub配布版のため、初回起動時にmacOSの確認が表示されます。

1. Open `drifttt` from the `Applications` folder.
2. If macOS says the developer cannot be verified, do not choose `Move to Trash`; choose `Done`.
3. Open macOS `System Settings`.
4. Go to `Privacy & Security`.
5. If you see a message that `drifttt` was blocked, choose `Open Anyway`.
6. When the confirmation popup appears, choose `Open`.

---

1. `Applications` フォルダから `drifttt` を開きます。
2. 「開発元を検証できないため開けません」のような表示が出た場合は、`ゴミ箱に入れる` を選ばず、`完了` を選択します。
3. Macの `システム設定` を開きます。
4. `プライバシーとセキュリティ` を開きます。
5. 画面下部に「driftttは使用がブロックされました」のような表示が出るので、`このまま開く` を選択します。
6. 確認ポップアップが出たら、`開く` を選択します。

## Setup / 初期設定

1. Allow microphone access when prompted.
2. Follow the app's setup screen and allow Accessibility access.
3. After adding `drifttt` to Accessibility, click `アクセシビリティ追加後に再起動` in the app.
4. Enter your OpenAI API key.
5. Hold the right Command key while speaking, then release it to insert the transcription.

---

1. マイク権限の確認が出たら、許可します。
2. アプリの設定画面に従って、`アクセシビリティ` 権限を許可します。
3. アクセシビリティに `drifttt` を追加したら、アプリ内の `アクセシビリティ追加後に再起動` を押します。
4. OpenAI APIキーを入力します。
5. 右Commandキーを押しながら話し、離すと文字起こし結果が入力されます。

## API Cost / 料金について

drifttt itself is free.

Speech recognition uses the user's own OpenAI API key. API usage fees are charged to the user's OpenAI account. The app includes an estimated monthly API cost view.

---

drifttt本体は無料です。

音声認識には利用者自身のOpenAI APIキーを使用します。API料金はOpenAIアカウント側で発生します。アプリ内で月間利用料金の目安を確認できます。

## Privacy / プライバシー

drifttt stores your API key on your Mac.

For transcription, recorded audio is sent to the OpenAI API using your own OpenAI API key. The drifttt maintainer does not collect your audio or transcription results.

Please avoid unofficial builds or redistributed copies, because drifttt handles user-provided OpenAI API keys.

---

driftttは、利用者のAPIキーを利用者のMac内に保存します。

文字起こしのため、録音音声は利用者自身のOpenAI APIキーを使ってOpenAI APIへ送信されます。driftttの開発者が音声や文字起こし結果を収集することはありません。

OpenAI APIキーを扱うアプリケーションのため、非公式の改変版や再配布版には注意してください。

## Source Code and Terms / ソースコードと利用条件

drifttt is published as source-available software for transparency, review, personal use, and feedback.

It is not licensed as open source software. You may read, study, run, and modify the source for personal use, and you may submit issues or pull requests. You may not sell, redistribute for a fee, or provide drifttt or a substantially identical app as a paid product or paid service.

See `LICENSE.md` for details.

---

driftttは、透明性の確保、内容確認、個人利用、改善提案のためにソースコードを公開しています。

ただし、オープンソースライセンスではありません。ソースコードの閲覧、学習、個人利用のための実行・改変、IssueやPull Requestによる改善提案は可能です。一方で、drifttt本体、または実質的に同じアプリを第三者へ販売・有償再配布・有償サービスとして提供することは許可していません。

詳しくは `LICENSE.md` を確認してください。

## Feedback / 意見箱

Bug reports, feature requests, and feedback are accepted through GitHub Issues.

不具合報告、改善提案、使ってみた感想はGitHub Issuesにお寄せください。

https://github.com/3plus6/drifttt/issues

## Support / 開発を支援

drifttt is distributed for free. If you find it useful, support is welcome.

driftttのアプリ本体は無料でご利用いただけます。便利だと思ったら、任意の金額でご支援いただけると嬉しいです。お問い合わせも下記ページにて承っております。

https://3plus6.jp/support.html
