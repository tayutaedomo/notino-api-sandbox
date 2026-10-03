# 機能と保証する動作

## 日次作成

`yarn all:create` は Retro → Body → Sleep の順に、それぞれ1ページを作成します。Diary は含みません。途中のコマンドが失敗すると後続を実行せず、終了コードは非0になります。全体のトランザクションや再実行時の重複排除はありません。

`NOTION_DB_ID_1/2/3` がそれぞれ Retro/Body/Sleep の DB ID です。東京時間の日付で `YYMMDD Retro/Body/Sleep` を Name に、`YYYY-MM-DD` を Date に設定します。

## 照会・取得

各 `*:query` は Created time 降順で最大3件を取得し、結果と先頭ページを表示します。`auth` はユーザー一覧による認証確認、`diary:page` はページ取得、`diary:blocks` は直下ブロックの最初のページを取得します。`search` は空文字列による検索結果の最初のページを表示します。

## 複製

`diary:dup` は Tags に diary を含むページを Name 降順で選択します。新しい Name (`YYMMDD Diary`)、Month (`YYYYMM`)、Tags (`diary`)、😃アイコンを設定し、本文を複製します。

`retro:dup` / `diary:dup2` は Name の文字列を検索し、Created time 降順で選択したページをコピーします。汎用 CLI の検索対象は title または rich_text です。TODO は未チェック化します。汎用コピーはプロパティ、絵文字／外部アイコン、外部カバーをコピーし、formula・rollup・作成／更新情報を除外します。copiedBlocks は直下の件数です。

## HTTP

helloWorld、notionAuth、notionCreatePage (`id`, `title`)、notionDuplicatePage (`id`)、notionCopyPage (`db`, `sp`, `sv`, `so`, 任意 `sod`) を公開します。入力と独自の戻り値キーを維持します。コピー対象なしは404、コピー処理の例外は500、必須パラメータなしは400です。

## 更新前の制約と改善対象

SDK 2.2.15 では Diary 複製は直下100件までです。汎用コピーは再帰・ページネーション取得を行いますが、追加を100件単位に分割しません。status はコピーされません。移行ではこれらの制約を改善します。添付ファイルの再アップロード、新しいブロック種別の作成対応は対象外です。
