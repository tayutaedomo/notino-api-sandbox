# notino-api-sandbox

Notionの日次ページ作成・照会・複製を行うTypeScriptプログラムです。このREADMEはプロジェクトの概要とドキュメントの入口です。

## 主な機能

- 日次作成：Retro → Body → Sleepの順にページを作成。
- 照会：DB、ページ、ブロックの取得と検索。
- 複製：プロパティと本文のコピー、TODOの未チェック化。

## ドキュメント

| 知りたいこと | 文書 |
|---|---|
| 環境構築・環境変数・コマンド | [使い方](docs/usage.md) |
| 各機能の仕様・コピーの制約 | [機能と保証する動作](docs/features.md) |
| 開発時のテスト・確認範囲 | [通常のテスト](docs/testing.md) |
| 専用DBでの最終確認・上限・ログ | [実API検証](docs/integration.md) |
| 中断したDB登録の修復 | [検証DBの手動復旧](docs/integration-recovery.md) |
| API差分・設計判断・本番への反映 | [Notion APIの保守方針](docs/notion-api.md) |
