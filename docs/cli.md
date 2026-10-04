# コマンドラインでの使い方

この文書は、普段使うCLIの環境構築・環境変数・実行コマンドを説明します。毎日の実行には `yarn all:create` を使います。機能の詳細は[機能仕様](features.md)を参照してください。

## 目次

- [実行環境](#実行環境)
- [環境変数](#環境変数)
- [日次作成](#日次作成)
- [コマンド一覧](#コマンド一覧)

## 実行環境

- Node.js 24 系。`package.json` の `engines.node` で宣言します。
- GCF用の間接依存 `cloudevents@10.0.0` の `engines.node` が `>=20 <=24` のため、現在はNode.js 24 系を使用します。
- Yarn Classic 1.22.x。
- Notion SDK 5.27.0 / API 2026-03-11 / TypeScript 5.9.x。

```sh
yarn install --frozen-lockfile
```

## 環境変数

### 必要な設定

値はプロセスの環境変数として渡します。設定例は[.env.sample](../.env.sample)を参照してください。

| 変数 | 用途 |
|---|---|
| `NOTION_KEY` | Notionの接続トークン |
| `NOTION_DB_ID_1` | RetroのDB ID |
| `NOTION_DB_ID_2` | BodyのDB ID |
| `NOTION_DB_ID_3` | SleepのDB ID |
| `NOTION_DB_ID_4` | DiaryのDB ID |
| `NOTION_PAGE_ID` | ページ・ブロック取得対象 |
| `NOTION_DATA_SOURCE_MAP` | 任意。DB ID → データソースIDのJSON |

- 実際のトークンやIDはGitに保存しません。
- `.env` などのローカル設定ファイルはGitの除外対象です。

### 複数データソースの指定

- 既存のDB IDをそのまま使えます。
- データソースが1件なら自動選択します。
- 複数なら `NOTION_DATA_SOURCE_MAP` で選択します。
- 不明・不正な指定は書き込み前にエラーになります。

```sh
export NOTION_DATA_SOURCE_MAP='{"database-id":"data-source-id"}'
```

所属の検証方法は[データソースの選択](notion-api.md#データソースの選択)を参照してください。

## 日次作成

```sh
yarn all:create
```

- Retro → Body → Sleepの順に作成し、途中の失敗で停止します。
- 再実行による重複排除はありません。
- 失敗した場合は、作成済みページを確認してから再実行を判断します。

## コマンド一覧

すべて `yarn <コマンド>` で実行します。

| コマンド | 用途 |
|---|---|
| `all:create` | Retro・Body・Sleepの日次作成 |
| `retro:create` / `body:create` / `sleep:create` | 各ページの作成 |
| `retro:query` / `body:query` / `sleep:query` / `diary:query` | Created time降順で最大3件取得 |
| `retro:dup` / `diary:dup2` | 条件に一致する最新ページのコピー |
| `diary:dup` | 当日の日付・月・タグを設定したDiary複製 |
| `auth` / `search` | 認証確認・検索 |
| `diary:page` / `diary:blocks` | ページ・直下ブロック取得 |
