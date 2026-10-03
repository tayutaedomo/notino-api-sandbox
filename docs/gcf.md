# GCFの使い方

この文書は、GCFへのデプロイとデプロイ後のHTTP呼び出しを説明します。GCFはクラウド上の関数として利用します。普段のローカル実行は[コマンドラインでの使い方](cli.md)を参照してください。

## 目次

- [準備](#準備)
- [デプロイ](#デプロイ)
- [HTTPで呼び出す](#httpで呼び出す)
- [開発時のローカル確認](#開発時のローカル確認)
- [移行検証の範囲](#移行検証の範囲)

## 準備

### 実行環境

- Node.js 24以上、Yarn Classic 1.22.x。
- Google Cloud SDK（`gcloud`）。
- デプロイ先プロジェクトと認証・権限の設定。

```sh
yarn install --frozen-lockfile
```

### Notionの設定

- `hello` 以外は、Notion接続トークンを `NOTION_KEY` に設定します。
- トークンはデプロイ元プロセスの環境変数で渡します。Gitには保存しません。
- 既存デプロイスクリプトは `NOTION_KEY` をクラウド関数の環境変数に設定します。
- DB IDやコピー条件は、HTTPリクエストのクエリ引数で渡します。
- 複数データソースを選択する場合は、クラウド関数側にも `NOTION_DATA_SOURCE_MAP` を設定します。既存デプロイスクリプトはこの変数を転送しません。

## デプロイ

### 対象を選んで実行する

| コマンド | デプロイする関数 | 用途 |
|---|---|---|
| `yarn gcf:hello:deploy` | `helloWorld` | 接続確認 |
| `yarn gcf:auth:deploy` | `notionAuth` | Notion認証確認 |
| `yarn gcf:create:deploy` | `notionCreatePage` | ページ作成 |
| `yarn gcf:dup:deploy` | `notionDuplicatePage` | Diary複製 |
| `yarn gcf:copy:deploy` | `notionCopyPage` | 条件指定のページコピー |

### 既存スクリプトの動作

- `gcf:predeploy` でビルドし、`package.json` と `yarn.lock` を配置してからデプロイします。
- 第2世代、リージョン `asia-northeast1`、ランタイム `nodejs24`、HTTPトリガーを指定します。
- `--allow-unauthenticated` を指定するため、呼び出し元の認証を要求しない構成です。
- デプロイするとクラウド環境を変更します。

## HTTPで呼び出す

- 対象関数のデプロイ結果に表示されるURLを使います。
- 引数とエラーは[HTTPの機能仕様](features.md#http)を参照してください。
- 作成・複製・コピーを呼び出すとNotion上のリソースを作成します。

ページ作成の例：

```sh
curl --get '<notionCreatePageのURL>' \
  --data-urlencode 'id=<DB ID>' \
  --data-urlencode 'title=Retro'
```

## 開発時のローカル確認

### ビルドと起動

```sh
yarn gcf:build
yarn gcf:create:local
```

- `yarn gcf:<機能>:local` でFunctions Frameworkをローカル起動します。
- `<機能>` は `hello` / `auth` / `create` / `dup` / `copy` です。
- ローカル起動でも、Notion機能の呼び出しは実APIへ接続します。

### モックでHTTP契約を確認する

- `yarn test:http` はNotion通信をモックして確認します。
- 開発時の確認方法は[通常のテスト](testing.md)を参照してください。

## 移行検証の範囲

- 今回の移行ではビルドとローカルHTTP確認までを検証します。
- クラウド実デプロイは今回の検証範囲外です。
