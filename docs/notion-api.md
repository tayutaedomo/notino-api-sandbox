# Notion API の保守方針

## バージョンと差分

更新前: SDK 2.2.15、API 2022-06-28（SDK の既定値）。移行先: SDK 5.27.0、API 2026-03-11。確認日: 2026-10-03。

- database と data source の分離: DB ID を入力として維持し、データソースを解決して query とページ作成に使う。
- databases.query → dataSources.query、作成親 database_id → data_source_id。
- search の database 結果 → data_source 結果。Notion の生JSONは新仕様に従う。
- archived → in_trash、after → position、transcription → meeting_notes。
- SDK は標準 fetch を使用。TypeScript は5.9以上が必要。
- SDK の既定 API は2025-09-03なので、全クライアントで2026-03-11を明示する。
- 自動リトライは無効化し、書き込みを黙って再送しない。途中失敗後の再実行は既作成ページを確認して判断する。

## データソースの選択

DBにデータソースが1件なら自動選択します。複数の場合は NOTION_DATA_SOURCE_MAP に JSON オブジェクトを指定します（DB ID → data source ID）。指定先がDBに属さない場合や対象が曖昧な場合は書き込み前に失敗させます。

## 検証と運用

日次作成を最優先に、モックによる回帰テスト→専用検証DBでの実API確認の順で進めます。main と定期実行環境は別 worktree の検証が完了するまで変更しません。GCFはNode.js 24でのビルド・ローカルHTTP確認までです。

反映は定期実行と重ならない時間に行い、yarn.lockに従って依存関係を更新します。初回は3ページの作成を確認します。問題時は元のコミットとロックファイルに戻して依存関係を再インストールします。途中作成済みのページを確認し、全体を自動で再実行しません。

## 公式情報

- [旧SDKの既定API](https://github.com/makenotion/notion-sdk-js/blob/v2.2.15/src/Client.ts)
- [2025-09-03 移行ガイド](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03)
- [2026-03-11 移行ガイド](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11)
- [SDK 5.27.0](https://github.com/makenotion/notion-sdk-js/releases/tag/v5.27.0)
- [SDKの互換性](https://github.com/makenotion/notion-sdk-js#requirements-and-compatibility)
- [GCFランタイム](https://docs.cloud.google.com/run/docs/runtimes/nodejs)
