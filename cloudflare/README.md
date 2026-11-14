# Cloudflare Pagesでの公開CSV連携

現在の公開先：`https://han-korean-study.pages.dev/`。GitHub `ysdriki-cmyk/han-korean-study` のmainから自動デプロイする。

| 項目 | 値 |
| --- | --- |
| Framework | None |
| Root directory | リポジトリのルート（空欄） |
| Build command | `exit 0` |
| Build output directory | `dist` |

`functions/` は `dist/` の外、リポジトリのルートに置く。公開先に `/dist/index.html` だけが存在し `/` が404なら、出力ディレクトリがリポジトリ全体になっていないか確認し、`dist` へ修正して再デプロイする。

## 設定済みの教材

`functions/api/content/[deck].js` が公開Google CSVを読み取り、同じオリジンから返す。接続先は利用者が共有した公開済みCSVで、APIキーや追加のGoogleログインは不要。

| API | Google Sheetsのgid | 上書き用環境変数（任意） |
| --- | --- | --- |
| `/api/content/kanji` | `29317581` | `KANJI_SHEET_CSV_URL` |
| `/api/content/vocabulary` | `0` | `VOCABULARY_SHEET_CSV_URL` |
| `/api/content/sentence` | `64554523` | `SENTENCE_SHEET_CSV_URL` |
| `/api/content/variation` | `1475350480` | `VARIATION_SHEET_CSV_URL` |

現在の公開URLはルート内に設定済み。環境変数がなければそのURLを使う。別のSheetへ変更する場合は環境変数または固定URLを更新し、再デプロイする。環境変数はProductionとPreviewで必要に応じて分ける。

アプリの接続先は `dist/assets/config.js` の教材別 `csvUrl`。TOPIK1は別CSVではなく単語CSVの空欄でないTOPIK1列から生成する。列の仕様は[教材シートの形式](../docs/content-schema.md)を参照。

variationは専用の公開シートから読み取る。接続設定は`config.variation.csvUrl: '/api/content/variation'`、予備教材は`config.variation.fallbackCsvUrl: './data/variation.csv'`。専用シート内では`ジャンル`・`#variation`を省略でき、既存sentenceシートへの追記は不要。取り込み方と列一覧は[variationの管理ガイド](../docs/variation.md)を参照する。

## 演習セット用の追加シート

`category_enshu` の入力形式は[カテゴリ設定](../docs/category-sets.md)と[サンプルCSV](../docs/templates/category_enshu.csv)を参照する。公開URL（gid `297489818`）は `functions/api/category-sets.js` に設定済み。アプリの `categorySetsCsvUrl` は `/api/category-sets` を使う。接続先を変える場合だけ環境変数 `CATEGORY_SHEET_CSV_URL` で上書きでき、公開CSVのためSecretやAPIキーは不要。

通常の教材CSVとは別に取得・検証し、シートの条件変更を約60秒ごとに反映する。空のCSV・見出しだけのCSV・有効なセットが0件の定義は、演習に使える正常版として扱わない。最初の正常な定義をまだ取得できない場合は教材のタグから自動生成したセット、正常な定義を取得した後の失敗時はその定義を維持する。

カテゴリの取得結果は管理ページで確認する。演習画面へ技術的な通知は出さない。正常な定義を取得するとシートに記載されたセットだけを表示し、自動生成タグのセットへ勝手に広げない。

## 更新

- 表示中のタブで約60秒ごと、タブに戻ったときにも最新CSVを確認する。
- Pages Functionsでは正常な公開CSVを5分キャッシュし、期限後は保存版を返しながら再取得する。Google側の公開反映と合わせ、スプシ編集から反映まで数分かかる場合がある。
- Googleの公開版への更新には数分かかる場合がある。編集ごとのGitHubコミットや再デプロイは不要。
- 初回表示は最新CSVを優先。失敗時は最後に正常取得した同じURLのCSV、なければ同梱教材を使う。
- 読込失敗・不正なCSV・ID重複では今の教材を保持し、学習記録を削除しない。
- variationは`han-hanja:content:v1:variation`へ独立して保存する。取得失敗・空シート・不正なCSVでは最後の正常版、なければ同梱24文を使い、sentence側の行によって専用教材を置き換えない。
- セット中の問題や採点用の対応表を途中で差し替えない。次のセットから新しい教材を使う。

## 読み取りAPIの範囲

GET/HEADのみ。HTTPSのGoogle Sheets CSV URLだけを許可し、Googleの配信用ホスト以外へのリダイレクトを拒否する。取得は12秒、サイズは3 MiBまで。HTMLやログイン画面は拒否し、応答はCache-Control: no-store。

取得先を利用者のURL引数で指定する中継APIにはしない。未設定・設定不備は503、取得失敗は502、書き込み要求は405。内部エラーや秘密値を応答に含めない。

旧 `/api/cards` と `SHEET_CSV_URL` は1教材用の互換APIとして残す。現在の複数シート連携では使わない。

## 管理画面

`/admin/` 以下に管理用画面を配置し、`dist/_redirects` で配下のURLを同じHTMLへ解決する。学習画面にリンクは置かない。教材の取得失敗・予備教材への切替は通常画面へ通知せず、`/admin/content/` で確認する。

管理画面のAPI確認と通常画面の使用元を分け、スプシ・保存済み・同梱教材、確認日時、成功日時、件数を表示する。`/admin/schema/` は実際のCSVから列とセルを確認し、`/admin/storage/` と `/admin/guide/` は保存状態と更新手順を表示する。

`/admin/sentences/` はsentenceとhan_wordsの最新CSVを照合し、未登録・ID不一致・複数候補の語を例文ID・使用列と一緒に表示する。CSVで書き出せる。どちらかの取得に失敗した場合は正常を装わず、照合を保留する。

現状は管理者認証なし。URLを知る人は閲覧可能であり、noindexや導線を隠すことは認証の代わりにならない。Cloudflare Accessを使う場合は `/admin` と `/admin/*` を対象に、許可する管理者を限定する。秘密値や他の利用者の記録をこの画面へ返すAPIは設けていない。

## 学習記録

記録は現在もブラウザ内の `han-hanja:learning:v3` に教材・方向別で保存する。教材更新は記録の同期ではない。ユーザー認証、端末間同期、旧ChatGPT Siteからの履歴移行は別途実装する。

variationの学習記録も`sentence:<id_sentence>`を使う。専用シートへ移しても同じIDなら読み書き別の記録を維持できるが、既存sentenceとvariationの別の文に同じIDを付けない。`var_`等の専用接頭辞を使うと管理しやすい。

参考：[Cloudflareの静的HTML設定](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)、[Pages Functions](https://developers.cloudflare.com/pages/functions/get-started/)、[Google公開版の更新](https://support.google.com/docs/answer/183965?hl=ja)。
