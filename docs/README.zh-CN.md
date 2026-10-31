# dagdo for Orca

[English](../README.md) | [日本語](README.ja.md) | 简体中文 | [Español](README.es.md)

**用依赖关系图看清阻塞，找到下一步可以开始的任务。**
浏览器与CLI共享本地数据，无需账号、API密钥或云服务。
支持Windows、macOS和Linux，Orca集成可选。界面和命令输出为英语，任务与备注支持中文。

## 功能

- 可视化任务依赖，拒绝循环依赖；用`next`查看可开始的任务。
- 多项目、Backlog、备注、树形和思维导图布局、明暗主题。
- 浏览器实时更新，CLI提供JSON输出，便于脚本和智能体使用。
- 共享撤销/重做、并发写入锁、保留最近30份备份。
- 可选：从Ready任务创建独立的Orca Git工作区。

## 下载与安装

按照[Bun官方说明](https://bun.sh/docs/installation)安装 **Bun 1.4.4或更新版本**。
使用Git时，在PowerShell、Bash或Zsh中执行：

```sh
git clone https://github.com/OsamuMikumo0704/dagdo-for-orca.git dagdo/app
cd dagdo/app
bun install --frozen-lockfile
bun run build
bun run start
```

也可[下载源代码ZIP](https://github.com/OsamuMikumo0704/dagdo-for-orca/archive/refs/heads/main.zip)，
解压到专用的`dagdo/app`目录，再执行最后三条命令。ZIP运行不需要Git。
本分支没有桌面安装包、npm发布或Homebrew安装方式。

启动前会自动备份，然后打开 **http://localhost:3737**。保持终端开启，
使用 **Ctrl+C** 或界面的 **Shut down** 停止服务。
不自动打开浏览器：`bun run start --no-open`；更换端口：`bun run start --port 3837`。
Windows也可以使用`scripts/start.ps1`和`scripts/stop.ps1`在后台运行。

## 第一个依赖关系

```sh
bun run scripts/dagdo.ts add '设计数据库' --json
bun run scripts/dagdo.ts add '实现接口' --after <design-id> --json
bun run scripts/dagdo.ts next --json
bun run scripts/dagdo.ts done <design-id> --json
```

将`<design-id>`替换为第一条命令返回的ID。完成设计后，实现任务即可开始。
多个项目时，先运行`projects --json`，再为任务命令添加`--project <ID>`。
在浏览器中双击任务编辑，通过拖动连接点建立依赖，将Backlog任务拖入画布即可转为Ready。

## 数据与维护

源码放在`dagdo/app`时，私有数据位于`dagdo/data`，备份位于`dagdo/backups`。
每个安装使用独立的父目录，同一父目录下会共享数据。附加Git worktree使用各自的
`.dagdo-dev/`和虚构示例。`DAGDO_DATA_DIR`与`DAGDO_BACKUP_DIR`只对相应进程设置，不要全局设置。

```sh
bun run backup
# 先停止UI及所有写入任务的智能体
bun run restore /absolute/path/to/dagdo/backups/GENERATION --writes-stopped
```

不要直接编辑`data.json`。任务与备份是未加密JSON，请保护文件权限，
不要提交个人任务、日志、密钥和`.env`。更新前停止服务并备份，然后执行
`git pull --ff-only`、`bun install --frozen-lockfile`、`bun run check`，再启动。
ZIP用户备份后仅替换源代码。此服务仅供本机单用户使用，不要暴露到公网。

## 帮助与贡献

- [完整命令参考](../README.md#use-the-cli)或`bun run scripts/dagdo.ts help`
- [跨平台运维与故障排查](operations.md)
- [问题与建议](https://github.com/OsamuMikumo0704/dagdo-for-orca/issues/new/choose)
- [参与开发与翻译](../CONTRIBUTING.md) · [私下报告安全问题](../SECURITY.md)

使用MIT许可证，保留[原作者版权](../LICENSE)与[第三方致谢](../THIRD_PARTY_NOTICES.md)。
