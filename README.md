# notino-api-sandbox

Notion の日次ページ作成・照会・複製を行う TypeScript プログラムです。

## 実行環境

- Node.js 24以上（`.node-version` は24.13.0）
- Yarn Classic 1.22.x
- Notion SDK 5.27.0 / API 2026-03-11 / TypeScript 5.9.x

```sh
yarn install --frozen-lockfile
yarn all:create
```

`all:create` は Retro → Body → Sleep の順に作成し、途中で失敗すると停止します。再実行で重複を防ぐ仕組みはありません。作成済みページを確認してから再実行してください。

## 環境変数

| 変数 | 用途 |
|---|---|
| NOTION_KEY | Notion の接続トークン |
| NOTION_DB_ID_1 | Retro の DB ID |
| NOTION_DB_ID_2 | Body の DB ID |
| NOTION_DB_ID_3 | Sleep の DB ID |
| NOTION_DB_ID_4 | Diary の DB ID |
| NOTION_PAGE_ID | ページ・ブロック取得対象 |
| NOTION_DATA_SOURCE_MAP | 任意。複数データソースの選択用 JSON（DB ID → data source ID） |

既存の DB ID をそのまま使えます。単一データソースは自動選択します。複数なら `NOTION_DATA_SOURCE_MAP='{"database-id":"data-source-id"}'` を指定します。不明・不正な指定は書き込み前に失敗します。

## コマンド

| コマンド | 用途 |
|---|---|
| all:create | Retro・Body・Sleep の日次作成 |
| retro/body/sleep:create | 各ページの作成 |
| retro/body/sleep/diary:query | Created time 降順で最大3件取得 |
| retro:dup / diary:dup2 | 条件に一致する最新ページのコピー |
| diary:dup | 当日の日付・月・タグを設定した Diary 複製 |
| auth / search | 認証確認・検索 |
| diary:page / diary:blocks | ページ・直下ブロック取得 |
| gcf:build / gcf:*:local | GCF ビルド・ローカル起動 |
| gcf:*:deploy | GCF デプロイ（実行するとクラウドを変更） |

## 自動テスト

```sh
yarn test
yarn typecheck
yarn test:http
```

`test` はネットワークをモックして日次コマンド・CLI・コピー・失敗ケースを検証します。`test:http` は Functions Framework をローカル起動し、Notion 通信をモックして HTTP 契約を検証します。型チェックには CLI とテストも含みます。

## 専用DBでの実API確認

1. 本番と別の空の検証 DB を4つ作り、検証用接続に共有します。
2. Retro・Body・Sleep は Name（title）、Date（date）、Created time（created_time）を用意します。
3. Diary は Name（title）、Month（number）、Tags（multi_select）、Status（status、少なくとも1つの選択肢）、Created time（created_time）を用意します。
4. 読み取り・挿入・更新とユーザー一覧の権限を付与します。
5. `.env.test.example` を `.env.test.local` にコピーし、検証用トークンとDB IDだけを設定します。実際の値はコミットしません。
6. `yarn test:integration` を実行します。

このコマンドは通常の NOTION_KEY / NOTION_DB_ID を流用せず、検証用変数だけを使います。全 DB の構成と空状態を確認してから `yarn all:create` を実行し、作成先・件数・タイトル・日付を再取得で検証します。照会、階層コピー、TODO、status、Diary複製も確認します。最後に検証が作成したページをゴミ箱へ移動します。失敗時も後片付けを試みますが、途中作成済みのページを確認してから再実行してください。日付が変わる時間帯を避けて実行します。

検証情報がない場合はエラーで終了します。自動テストが成功しても、専用DBでの確認が完了するまでは移行完了ではありません。GCF のクラウド実デプロイは今回の検証範囲外です。

- [機能と保証する動作](docs/features.md)
- [API差分・決定事項・更新と復旧](docs/notion-api.md)
