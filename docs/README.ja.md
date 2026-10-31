# dagdo for Orca

[English](../README.md) | 日本語 | [简体中文](README.zh-CN.md) | [Español](README.es.md)

**依存関係を見える化し、今取り組めるタスクを見つけるローカルアプリです。**
ブラウザのグラフとCLIが同じデータを共有します。アカウント、APIキー、クラウドは不要です。
Windows・macOS・Linuxに対応し、Orcaとの連携は任意です。
画面とコマンド出力は英語ですが、タスク名とメモには日本語などを使えます。

## できること

- タスクを線で結び、前提条件とブロッカーを確認。循環する依存関係は作成できません。
- Ready・In Progressのうち、着手可能なタスクを一覧と`next`で確認。
- プロジェクト、Backlog、メモ、ツリー・マインドマップ表示、明暗テーマ。
- ブラウザ・CLI・エージェント間の自動更新とJSON出力。
- 共有Undo/Redo、ロックによる同時更新保護、直近30世代のバックアップ。
- 任意でReadyタスクからOrcaの独立したGitワークスペースを作成。

## ダウンロード・セットアップ

[Bun公式のインストール手順](https://bun.sh/docs/installation)で **Bun 1.4.4以上** を用意してください。
Gitを使う場合、以下はPowerShell・Bash・Zsh共通です。

```sh
git clone https://github.com/OsamuMikumo0704/dagdo-for-orca.git dagdo/app
cd dagdo/app
bun install --frozen-lockfile
bun run build
bun run start
```

[ソースZIP](https://github.com/OsamuMikumo0704/dagdo-for-orca/archive/refs/heads/main.zip)も利用できます。
専用の`dagdo/app`フォルダに展開し、そこで最後の3コマンドを実行します。ZIPではGit不要です。
このフォーク用のデスクトップインストーラー、npm配布、Homebrew配布はありません。

バックアップ後、**http://localhost:3737** が開きます。ターミナルは開いたままにし、
**Ctrl+C**または画面の**Shut down**で終了してください。
ブラウザを自動で開かない場合は`bun run start --no-open`、
別ポートなら`bun run start --port 3837`を使います。
Windowsでは任意で`.\scripts\start.ps1`と`.\scripts\stop.ps1`によるバックグラウンド運用も可能です。

## 最初のタスク

```sh
bun run scripts/dagdo.ts add '設計する' --json
bun run scripts/dagdo.ts add '実装する' --after <design-id> --json
bun run scripts/dagdo.ts next --json
bun run scripts/dagdo.ts done <design-id> --json
```

`<design-id>`は最初の出力のIDに置き換えます。設計を完了すると実装に着手できます。
プロジェクトが複数なら`projects --json`でIDを調べ、タスク操作に`--project <ID>`を付けます。
ブラウザではダブルクリックで編集し、ハンドル同士をドラッグして依存関係を作れます。
BacklogのタスクはマップにドラッグするとReadyになります。

## データとバックアップ

ソースを`dagdo/app`に置くと、データは隣の`dagdo/data`、バックアップは`dagdo/backups`です。
各インストールには専用の親フォルダを使ってください。同じ親フォルダではデータを共有します。
Gitの追加ワークツリーは各自の`.dagdo-dev/`に架空データを持ちます。
`DAGDO_DATA_DIR`・`DAGDO_BACKUP_DIR`は必要なプロセスにだけ設定し、グローバルには設定しないでください。

```sh
bun run backup
# UIと書き込むエージェントをすべて停止してから実行
bun run restore /absolute/path/to/dagdo/backups/GENERATION --writes-stopped
```

`data.json`を直接編集しないでください。データとバックアップは暗号化されていないJSONです。
個人タスク、ログ、鍵、`.env`をコミットしないでください。
更新時は停止→バックアップ→`git pull --ff-only`→`bun install --frozen-lockfile`→
`bun run check`→再起動の順に進めます。ZIP利用時はバックアップ後にソースのみ置き換えます。
サーバーはローカル専用で、インターネットへ公開しないでください。

## ヘルプ・貢献

- [詳しい使い方](usage-ja.md)・[全OSの運用とトラブル対応（英語）](operations.md)
- [全CLIコマンド（英語）](../README.md#use-the-cli)・`bun run scripts/dagdo.ts help`
- [不具合・要望](https://github.com/OsamuMikumo0704/dagdo-for-orca/issues/new/choose)
- [翻訳・開発への貢献](../CONTRIBUTING.md)・[セキュリティの非公開報告](../SECURITY.md)

MITライセンスです。[原作者の著作権](../LICENSE)と[謝辞](../THIRD_PARTY_NOTICES.md)を保持しています。
