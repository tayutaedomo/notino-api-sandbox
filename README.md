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

1. 検証用の親ページを用意し、検証用接続に共有します。
2. 接続に読み取り・挿入・更新とユーザー一覧の権限を付与します。
3. `.env.test.example` を `.env.test.local` にコピーし、`NOTION_TEST_KEY` と `NOTION_TEST_PARENT_PAGE_ID` を設定します。通常の本番設定は流用しません。
4. 次のコマンドで予定を確認し、明示的に実行します。

```sh
# 通信・リソース操作なし。予定を表示
yarn test:integration
# DB作成 → 実API確認 → 検証ページとDBをゴミ箱へ移動
yarn test:integration --execute
```

Retro・Body・Sleep・Diary の空のDBと必要なプロパティをAPIで作成します。DB IDは検証プロセス内で自動設定します。実際の `yarn all:create` を起動し、作成先・件数・タイトル・日付を再取得で検証します。照会、階層コピー、TODO、status、Diary複製も確認します。日付が変わる時間帯を避けて実行してください。

### 実行上限とログ

- 通常の自動テスト・インストール・定期実行から実API検証を起動しません。スケジュール登録も行いません。
- 1回あたりDB4個・ページ6個・本文9ブロックまで。失敗した作成要求も枠を消費します。
- API通信は子プロセスも含め1秒間隔、通常120件まで。後片付け用に別途30件を確保します。
- 同時実行を拒否し、新規実行は24時間に1回、保存した履歴で累計5回まで。未完了の実行がある場合は新規作成を拒否します。
- `.notion-test-runs/<実行ID>.jsonl` に日時・操作・HTTP結果・作成ID・CLIの成否を記録します。送信前にも記録し、ログを保存できない場合は送信しません。
- 同じディレクトリの `.json` に件数・対象ID・後片付け状態・結果不明の要求を保存します。トークン・認証ヘッダー・本文・プロパティ値・CLIの生出力は保存しません。
- ログと状態はローカルに保持し、Gitには含めません。IDを含むため権限はファイル0600、ディレクトリ0700で作成します。制限はこのチェックアウトに保存した履歴に基づくため、履歴を削除したり別コピーから並列実行したりしないでください。

429/529では再送せず停止し、`Retry-After` が経過するまで後片付けの通信も拒否します。タイムアウトや5xxで作成結果が不明な場合も再作成しません。共有ワークスペースの他の通信や残容量はこの制限だけでは保証できません。複数メンバーのFreeワークスペースは削除しても累計作成枠が戻らないため、実行前にワークスペースの利用量を確認してください。

### 後片付けの再開

```sh
# 予定確認（通信なし）
yarn test:integration --cleanup <実行ID>
# 記録済みDBだけを後片付け。新規作成なし
yarn test:integration --cleanup <実行ID> --execute
# 強制終了で残ったロックを回収。元プロセスが生きている場合は拒否
yarn test:integration --cleanup <実行ID> --execute --recover-lock
```

DBの親ページと実行ID入りの名前を再確認してからゴミ箱へ移します。親ページや他のDBは削除しません。完全削除ではありません。後片付けの再開も元の通信上限を引き継ぎます。上限到達や結果不明の要求は自動解除しません。ログを保持したまま対象リソースをNotion上で確認し、容量・通信・状態を確認してから対応してください。DB作成の結果が不明な場合は、親ページで `Notion API Test <実行ID>` の名前を確認できます。

自動テストが成功しても実API確認が完了するまでは移行完了ではありません。GCFのクラウド実デプロイは今回の検証範囲外です。

- [機能と保証する動作](docs/features.md)
- [API差分・決定事項・更新と復旧](docs/notion-api.md)
