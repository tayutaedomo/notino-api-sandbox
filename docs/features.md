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

## 更新前の制約と改善結果

SDK 2.2.15 では Diary 複製は直下100件までです。汎用コピーは再帰・ページネーション取得を行いますが、追加を100件単位に分割しません。status はコピーされません。移行後は両方式で全階層を取得し、100件単位で追加します。status もコピーします。空本文は追加なしで成功し、対象なしは明確なエラーになります。添付ファイルの再アップロード、新しいブロック種別の作成対応は対象外です。

## コピーの境界

本文は API で作成可能な既存のブロック種別だけを変換します。meeting_notes / transcription、child_page、child_database、link_preview、unsupported などは新ページ作成前にエラーになります。新しい heading_4 / tab の作成対応は今回追加しません。同期ブロックは参照先への同期を維持せず、独立した本文としてコピーします。

テーブルは最初の行、カラムは初期の子ブロックを含めて作成し、残りを順に追加します。空のカラム、2列未満のカラム一覧、カラム先頭にテーブル／カラム一覧がある構造は事前に拒否します。内部メディアは元URLを external として作成します。ファイルの再アップロードは行いません。署名付きURLの寿命は延長しません。
