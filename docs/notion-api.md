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

## 依存関係と検証の決定事項

Node.js 24では旧 Functions Framework の cloudevents 8 にあるNode.js上限制限がインストールを妨げるため、Frameworkを5.0.5（cloudevents 10）へ更新しました。最終版はエンジン制限を無視せずインストールします。

テストは node:test、ts-node、Nock 14を使用します。旧SDKで日次コマンドを含む回帰テストを成功させてから新APIへ移行しました。新仕様の失敗テストを先に追加し、成功した段階でコミットします。コミットは Conventional Commits、日本語の短い件名、箇条書きの本文を使用します。

専用DBの実API確認は README の準備手順に従います。実API確認前にmainへ反映せず、モックテストの成功と実APIでの確認結果を区別します。

## 実API検証のリソース管理

`yarn test:integration` の既定動作は通信なしの予定表示です。`--execute` を明示した場合だけ検証用の親ページ配下にDB4個を作成し、既存の検証処理を実行してページとDBを `in_trash: true` にします。現在のAPIでは `initial_data_source.properties` でスキーマを指定し、`status: {}` で標準の選択肢を作成できます。

作成要求と通信の上限は `scripts/lib/integration_safety.ts` に固定しています。CLI子プロセスにも専用preloadで同じ通信制御を適用します。通常処理と後片付けの通信枠を分け、連続実行を24時間に1回、累計5回までに制限します。JSONLの監査ログと状態JSONは送信前・結果取得後にディスクへ同期し、再開時も上限を引き継ぎます。実際のIDは監査のためローカル保存しますが、Gitには保存しません。CLI終了コード・中断も記録し、タイムアウト時はYarnを含む子プロセス群を停止してから後片付けします（macOS/Linuxのプロセスグループを使用）。

429/529のRetry-Afterには従いますが自動再試行はしません。作成の通信失敗や5xxは結果不明として記録し、新規実行を停止します。後片付けでDBの親と実行ID入りの名前が確認できない場合も削除せず止めます。通信枠超過・結果不明・累計上限は人がログとNotionのリソースを確認するまで自動解除しません。上限解除のために履歴を削除しないでください。

Freeワークスペースの累計ブロック枠は削除しても回復しません。通信制限はワークスペース内の他の接続とも共有されるため、専用接続と小さい検証だけで残容量を保証することはできません。利用量を確認してから明示実行します。DBを完全削除する処理は実装しません。

- [DB作成API](https://developers.notion.com/reference/create-database)
- [データソースのプロパティ](https://developers.notion.com/reference/property-object)
- [リクエスト制限](https://developers.notion.com/reference/request-limits)
- [ワークスペースのブロック制限](https://developers.notion.com/reference/workspace-block-limits)

## モックを中心にする検証方針

通常の開発・修正の確認はモックの単体テスト・CLI子プロセステスト・ローカルHTTPテストと型チェックで行います。実API検証は移行の最後の仕上げ、またはモックでは判断できないサーバーの受理条件や実レスポンスの確認時だけ、明示実行します。実API側で認証・各CLIの照会・Diary複製を重複確認せず、all:createと階層・TODO・statusコピーの保存結果に絞ります。作成上限をページ5個・本文6ブロック、通常通信80件に縮小しました。実APIの繰り返し実行でモックの不足を補わず、不足する仕様は先にモックのテストへ追加します。
