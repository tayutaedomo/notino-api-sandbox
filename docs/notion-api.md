# Notion APIの保守方針

この文書は、採用バージョン・API差分・設計判断・本番への反映手順を説明します。既存のDB IDと日次コマンドを維持し、APIを明示して自動リトライを無効にします。

## 目次

- [採用バージョン](#採用バージョン)
- [API更新による差分](#api更新による差分)
- [データソースの選択](#データソースの選択)
- [通信と依存関係の判断](#通信と依存関係の判断)
- [本番への反映と復旧](#本番への反映と復旧)
- [公式情報](#公式情報)

## 採用バージョン

確認日：2026-10-03。SDKとAPIは次のバージョンに固定します。

| 対象 | 更新前 | 採用版 |
|---|---|---|
| Notion SDK | 2.2.15 | 5.27.0 |
| Notion API | 2022-06-28（旧SDKの既定値） | 2026-03-11（全クライアントで明示） |
| TypeScript | — | 5.9.x |
| GCFランタイム | — | Node.js 24 |

SDK 5.27.0の既定APIは2025-09-03のため、SDK更新だけでは目標のAPIバージョンになりません。

## API更新による差分

| 差分 | 対応 |
|---|---|
| databaseとdata sourceの分離 | DB IDからデータソースを解決 |
| `databases.query` | `dataSources.query` へ移行 |
| ページ作成の `parent.database_id` | `parent.data_source_id` へ移行 |
| Search結果の `database` | `data_source` への変更を許容 |
| `archived` → `in_trash` | 新レスポンスに対応し、コピー要求から状態を除外 |
| `after` → `position` | 旧コードで `after` は未使用。分割追加は末尾へ順に追加 |
| `transcription` → `meeting_notes` | コピー対象外として事前に拒否 |

- 既存コマンド名・引数・DB ID・環境変数を維持します。
- アプリ独自の戻り値キーは維持し、Notionの生JSONは新仕様に従います。
- コピーの改善と制約は[機能仕様](features.md#移行による改善)を参照してください。

## データソースの選択

### 選択ルール

- 1件なら自動選択します。
- 複数なら `NOTION_DATA_SOURCE_MAP` のJSONでDB ID → データソースIDを指定します。
- 指定先がDBに属さない場合や対象が曖昧な場合は、書き込み前にエラーにします。

設定例は[使い方](usage.md#複数データソースの指定)を参照してください。

## 通信と依存関係の判断

### リトライ

- 共通クライアントでAPIバージョンと `retry: false` を明示します。
- 書き込みを黙って再送せず、既存の失敗・停止動作を維持します。
- 途中失敗後は、既作成ページを確認してから再実行を判断します。

### 実行環境

- SDKは標準 `fetch` を使います。
- SDKのTypeScript要件は5.9以上です。
- Functions Frameworkは5.0.5（cloudevents 10）を採用します。
- 旧Frameworkのcloudevents 8は、Node.js 24がエンジン上限に抵触します。
- 依存関係はエンジン制限を無視せず、`yarn.lock` に従ってインストールします。

## 本番への反映と復旧

### 検証完了まで

- 作業と検証は別worktreeで行い、`main` と定期実行の依存環境を変更しません。
- 最優先は日次の `all:create` です。
- [通常のテスト](testing.md) → [専用DBでの実API確認](integration.md)の順で検証します。
- 実API確認が完了するまでは移行完了としません。

### 本番への反映

1. 定期実行と重ならない時間に反映します。
2. `yarn.lock` に従って依存関係を更新します。
3. 初回実行でRetro・Body・Sleepの3ページが作成されたことを確認します。

### 問題が起きた場合

1. 元のコミットとロックファイルへ戻します。
2. 依存関係を再インストールします。
3. 途中作成済みのページを確認し、再実行を判断します。

検証DBの登録中断は[手動復旧手順](integration-recovery.md)に従います。

## 公式情報

### APIとSDK

- [旧SDKの既定API](https://github.com/makenotion/notion-sdk-js/blob/v2.2.15/src/Client.ts)
- [2025-09-03移行ガイド](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03)
- [2026-03-11移行ガイド](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11)
- [SDK 5.27.0](https://github.com/makenotion/notion-sdk-js/releases/tag/v5.27.0)
- [SDKの互換性](https://github.com/makenotion/notion-sdk-js#requirements-and-compatibility)

### 実行環境

- [GCFランタイム](https://docs.cloud.google.com/run/docs/runtimes/nodejs)
