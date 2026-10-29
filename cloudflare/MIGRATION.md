# GitHub・Cloudflareへの移行

2026-10-29更新。現在の本番はChatGPT Sites。独自GitHub・Cloudflareへの接続・デプロイは未実施。

## 構成と順序

GitHubでコードを管理し、Cloudflare Pagesで画面、Pages Functionsで教材取得、Google Sheetsで教材を編集する。将来の個人別学習記録はD1に保存する。教材編集は実行時の取得で反映し、コード変更だけをGitHubから自動デプロイする。

今のアプリはビルド不要なので、最初はPagesと既存Functionsを使う。元のSitesは動かしたまま検証する。

## 1. GitHub

1. 所有するアカウント・組織に非公開リポジトリを用意する。候補名は `han-korean-study`。
2. この `han-korean-study/` の内容をルートとして登録する。親の原本CSV・別プロジェクトは含めない。
3. 配信教材の列を見直す。現状の `dist/data/` にはアプリが使わない付随列もある。リポジトリが非公開でも配信ファイルは訪問者が取得できるため、公開前に必要な列へ絞る。
4. `.dev.vars`、`.wrangler/`、`.env`、認証鍵などのローカル設定・秘密値を登録しない。追加する設定ファイルも `.gitignore` を確認する。
5. `npm test` を実行し、以後はCIでも確認する。

Sites用Git接続がある場合は上書きせずGitHubを別リモートにする。`.openai/hosting.json` はSites用で、Cloudflareの設定・認証を代替しない。

### 初回の具体的な接続

確認時点でローカルGitは初期化済み、ブランチは `main`、リモートは未登録。`git init` は不要。対象は `/Users/yoi/Public/韓→漢/han-korean-study` で、HTMLがある `dist/` だけをGit管理のルートにはしない。

1. GitHubの [New repository](https://github.com/new) を開く。現在コネクターで確認できる個人アカウントは `ysdriki-cmyk`。
2. 名前は `han-korean-study`、公開範囲はPrivateを候補にする。README・gitignore・ライセンスを自動生成せず、空のリポジトリを作る。
3. ターミナルでGitHubへの認証を用意する。HTTPSならGitHub CLIの `gh auth login` 等を使う。CLIを使わずに進める場合は下記のGitHub Desktopの手順を選ぶ。ChatGPT内のGitHubコネクター接続と、ターミナルのGit認証は別。GitHubアカウントのパスワードをGitのパスワードとして入力しない。
4. 次を実行する。別アカウント・組織に作った場合はURLをそのリポジトリのものに置き換える。

```sh
cd "/Users/yoi/Public/韓→漢/han-korean-study"
git status --short
git remote -v
git add .
git commit -m "Prepare GitHub and Cloudflare deployment"
git remote add origin https://github.com/ysdriki-cmyk/han-korean-study.git
git push -u origin main
```

`git status` と差分で登録対象を確認してからコミットする。コミット対象がない場合はコミットを省略する。`origin already exists` が出たら既存URLを確認し、上書きせず、必要なら `github` など別名を使う。接続先に既にコミットがありpushを拒否されたら、履歴を確認して統合する。強制pushで解決しない。

GitHub Desktopを使う場合は、File → Add Local Repository で上記の `han-korean-study` を指定し、差分をコミットしてPublish repositoryする方法でもよい。非公開設定を確認する。この場合はDesktopが接続先を作るため、同名の空リポジトリを先に作成する手順と重ねて実行しない。

参考：[GitHub公式の既存ソース登録手順](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)。

## 2. Cloudflareの検証環境

Workers & Pages → Create application → Pages → Import an existing Git repository で対象リポジトリを接続する。検証環境の閲覧範囲を確認し、必要な閲覧制限を設定してから教材を配置する。

| 設定 | このフォルダをGitHubルートにする場合 |
| --- | --- |
| Framework | None |
| Production branch | 実際の本番用ブランチ（新規構成では `main` を候補にする） |
| Root directory | 空欄（リポジトリルート） |
| Build command | `exit 0` |
| Build output directory | `dist` |

親フォルダごと登録する場合だけRoot directoryを `han-korean-study` にする。`functions/` は `dist/` の外、Pagesプロジェクトのルートに置く。Functionsを含む配信にはGit連携を使い、ダッシュボードのドラッグ＆ドロップを使わない。

参考：[静的HTML](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/)、[Git連携](https://developers.cloudflare.com/pages/configuration/git-integration/)、[Functions](https://developers.cloudflare.com/pages/functions/get-started/)。

## 3. 教材連携

### 現状

- `/api/cards` は1つの公開Google CSVを返す。サーバー環境変数は `SHEET_CSV_URL`。非公開Sheetの認証には未対応。
- `assets/config.js` の `decks.kanji.csvUrl` または `decks.vocabulary.csvUrl` に `/api/cards` を設定すると、どちらか一方を接続できる。両方に設定しても同じCSVを読むため、2教材の接続にはならない。
- TOPIK1は同梱 `./data/topik1.csv` のみ。外部URL設定は未実装。
- 設定時は約60秒ごとに更新確認する。失敗時は同梱教材を使い、演習中のセットは差し替えない。

### 実装する内容

1. 2シートを固定ルートに分ける。設計例は `/api/content/kanji`、`/api/content/vocabulary`。これらはまだ存在しない。TOPIK1は単語シートのチェック列へ統合するため、別の取得先は設けない。
2. [新しい列名](../docs/content-schema.md)で解析する。IDの互換、明示的な別解、必須・有効フラグを検証する。
3. ID重複・必須列欠落・予期しない大量欠落を確認し、正常な版だけを配信する。不備・通信失敗時は直前の正常な教材を保持する。この永続的な正常版保持は未実装。
4. 単語シートの `TOPIK1=TRUE` かつ `有効=TRUE` の行から参考例を生成し、問題・解答・参考例の版をそろえる。演習中のセットは途中で変更しない。

公開CSVは簡単だが、Google側の公開反映は数分かかることがある。非公開の元シートを使うなら、対象Sheetへの閲覧権限を付けたサービスアカウント等でGoogle Sheets APIを呼び、秘密値はCloudflareのSecretに保存する。APIキーだけでは非公開Sheetの権限は得られない。共通教材のために利用者が各自Google連携する必要はない。

参考：[公開版の更新](https://support.google.com/docs/answer/183965?hl=ja)、[Googleの認証方法](https://developers.google.com/workspace/guides/create-credentials)。

既存APIの読み取り専用、GoogleのHTTPS URL限定、安全なリダイレクト、12秒の取得上限、3 MiBの容量上限、HTML拒否、接続先・内部エラーを応答に含めない制約を引き継ぐ。利用者のURL引数から任意の取得先を中継しない。

## 4. ログインと学習記録

現状はブラウザ内の `han-hanja:learning:v3` と `han-hanja:preferences:v4` に保存する。アカウント別保存・端末間同期はない。

独自Cloudflareでのログイン方式を別途選ぶ。Sitesのログイン用パス・認証ヘッダーをコピーしても認証は移らない。外部サイト向けSign in with ChatGPTは現在限定提供なので、Google等の別ログインも選択肢にする。[OpenAI公式](https://developers.openai.com/siwc/website)

D1には利用者ID・教材・カードID・学習方向ごとに評価、回数、正誤、履歴、復習日を保存する。APIはサーバーで認証済み利用者を確認し、本人の記録だけを読み書きする。

新しいドメインには現在のlocalStorageは自動で移らない。本番切り替え前に、元サイト上からの同期または一度だけの移行処理を用意する。

## 5. 切り替えの確認

- 教材ID・件数・必須442枚、問題のヒント、別解、音声、使用参考例。
- 未演習・少回数優先、通常演習の誤答48時間、復習モード、方向別評価。
- Sheet編集の反映、不備・通信失敗時の正常版保持、演習途中の内容保持。
- ログインごとの記録分離、別端末の同期、既存記録の移行。
- 閲覧範囲、配信教材に不要な付随列がないこと、秘密値が配信物にないこと。

確認後に利用者の入口を新環境へ切り替える。教材修正はSheets、コード変更はGitHubという運用にする。

## 接続後の普段の更新

コードはこのフォルダで編集し、テスト・差分確認・コミット・pushの順に進める。GitHub連携済みのCloudflare Pagesが自動デプロイするため、HTMLの手動アップロードは不要。

```sh
cd "/Users/yoi/Public/韓→漢/han-korean-study"
npm test
git diff
git add .
git commit -m "Describe the change"
git push
```

公開前に確認したい変更は別ブランチとPull Requestを使い、Cloudflareのプレビューで確認してから本番ブランチへ統合する。Cloudflareでは接続リポジトリ・本番ブランチ・公開ディレクトリ、デプロイ結果、環境変数・Secret、必要に応じてドメインを管理する。

教材は現状まだ同梱CSVなので、CSVを編集した場合もコードと同じコミット・pushが必要。外部Sheets連携を実装した後に、教材編集だけをSheetsで完結させられる。URLや鍵を追加するだけで新フォーマット、2シートの連携、ログイン・履歴同期まで完成したことにはしない。
