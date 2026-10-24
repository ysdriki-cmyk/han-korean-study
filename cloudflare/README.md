# 管理者向け: Cloudflare Pagesで教材を連携する

利用者は「漢字対応」と「単語暗記」の教材を切り替え、「意味を答える」「韓国語を書く」の2モードで学習します。どちらのモードも全ランクのカードをいつでも演習できます。教材CSV、Google Sheetsの接続先、更新間隔は管理者が配信時に設定し、利用者の画面にファイル入出力や接続設定を設けません。

## Pagesへ配置する

| 設定 | 値 |
| --- | --- |
| ルートディレクトリ | この `han-korean-study` フォルダ |
| フレームワーク | なし |
| ビルドコマンド | 空欄 |
| 出力ディレクトリ | `dist` |

`functions/` は `dist/` の外、プロジェクトのルートに置きます。`functions/api/cards.js` が `/api/cards` に対応します。[Cloudflare公式: Functionsの作成](https://developers.cloudflare.com/pages/functions/get-started/)、[ルーティング](https://developers.cloudflare.com/pages/functions/routing/)

アプリ本体だけなら静的配信で動きます。以下のFunctionは、Google Sheetsを同じオリジンから取得したい場合だけ使う任意の追加機能です。静的サイトを配信しただけではFunctionは起動しません。

## 教材接続を設定する

1. Google Sheetsの教材タブをCSV形式で公開します。
2. Pagesの環境変数 **`SHEET_CSV_URL`** に公開URLを設定します。ProductionとPreviewはそれぞれ設定してください。
3. `dist/assets/config.js` で、漢字教材なら `window.APP_CONFIG.decks.kanji.csvUrl`、単語教材なら `window.APP_CONFIG.decks.vocabulary.csvUrl` を `/api/cards` に設定します。
4. 再デプロイします。以後はアプリが設定された教材を読み込みます。

```text
https://docs.google.com/spreadsheets/d/e/公開ID/pub?gid=0&single=true&output=csv
```

`https://docs.google.com/spreadsheets/d/シートID/export?format=csv&gid=0` 形式も受け付けます。認証を必要としない教材用のシートを指定してください。管理者が公開CSVへ直接接続する構成にする場合は、対象教材の接続先にそのURLを設定し、Functionを省略できます。

同梱教材は漢字650枚・単語4,559枚です。2教材の接続先は別々に管理します。現在の `/api/cards` は環境変数一つで指定した一つのCSVを返すAPIです。両教材を別々のSheetsから中継する場合は、管理者が教材ごとの固定ルートと環境変数を追加してください。利用者のURL引数で任意の取得先を指定する構成にはしません。

初期表示は `defaultDeck: 'vocabulary'`、同梱教材は `decks.vocabulary.fallbackCsvUrl: './data/vocabulary.csv'` と `decks.kanji.fallbackCsvUrl: './data/cards.csv'` です。旧形式のトップ階層 `csvUrl` は漢字教材用の互換設定に限り、新しく設定する場合は `decks` の教材別URLを使います。

更新間隔は `config.js` の `refreshIntervalMs`、ブラウザの取得時間の上限は `fetchTimeoutMs` で管理します。利用者による接続操作は不要です。Googleの公開版への更新には数分かかる場合があるため、定期取得でも即時反映は保証できません。[Google公式の更新について](https://support.google.com/docs/answer/183965?hl=ja)

通常の `npm run dev` は静的サーバーです。ローカルでFunctionも確認する場合は、Wranglerのある環境でプロジェクトルートから `npx wrangler pages dev dist` を実行し、ローカル用の `SHEET_CSV_URL` を設定します。ローカルの環境変数ファイルはGitに含めません。

## 読み取りAPIの範囲

- `GET /api/cards` と `HEAD /api/cards` のみ。教材の変更や学習記録の送信は行いません。
- 取得先はサーバー側の `SHEET_CSV_URL` だけです。リクエストのURL引数による任意サイトの中継はしません。
- HTTPSのGoogle Sheets CSV URLを検証し、Googleの配信用ホスト以外へのリダイレクトを拒否します。
- 上流の取得は12秒で打ち切り、CSVは3 MiBまで受け付けます。HTMLのログイン画面はエラーにします。
- 応答に `Cache-Control: no-store` を付けます。Google側の公開更新の遅れは除けません。

未設定なら503、取得失敗・タイムアウトなら502、書き込み要求なら405です。環境変数の値や内部エラー本文は応答に含めません。

## 学習記録と将来の同期

現在の連携は **Sheets → アプリ** の教材読み取りです。共通ランクと方向別の学習記録は教材ごとに分けて各ブラウザに保存され、スプレッドシートには書き戻しません。利用者のファイル操作をなくしても、端末間の同期が追加されるわけではありません。

保存キー `han-hanja:learning:v3` のカードIDは `kanji:<No>` と `vocabulary:<No>` を使います。教材を追加・更新するときは、これらのIDを変更・再利用しません。

端末間で共有する段階では、利用者認証と、教材ID・カードIDをキーにした学習記録テーブルを追加します。スプレッドシートへの書き戻しには、サーバー側のGoogle Sheets API認証、更新権限、競合解決も必要です。サービスアカウント鍵やAPIトークンは `dist/` や公開JavaScriptに置きません。

このコードを追加しただけでは、利用者のCloudflareアカウントやGoogle Sheetsには接続されません。管理者による実際のURL・環境変数の設定と配信が必要です。
