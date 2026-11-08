# 开发指南

## 一次性准备

1. 安装 [Git](https://git-scm.com/) 和 [Node.js](https://nodejs.org/)（LTS 版本，20 或以上）。
2. 在 R 里设置 GitHub 凭证（只需一次）：

   ```r
   install.packages(c("usethis", "gitcreds"))
   usethis::create_github_token()   # 浏览器里生成令牌，勾选 repo 和 workflow
   gitcreds::gitcreds_set()          # 粘贴令牌
   ```

3. 在项目文件夹里安装依赖：`npm install`

## 日常流程

```bash
git pull                 # 先拉取最新版本
npm run dev              # 打开终端里显示的地址，改代码后页面自动刷新
# …修改代码…
npm test                 # 单元测试
npm run e2e              # 端到端测试（构建后在 Chromium 里操作；第一次先运行 npx playwright install chromium）
npm run build            # 类型检查 + 生成 dist/index.html
git add -A
git commit -m "简短说明这次改了什么"
git push
```

推送到 `main` 后，GitHub Actions 会自动跑测试。在线版只在发布新版本时更新（见下面「发布新版本」）。

## 在 RStudio 中

- File → New Project → Existing Directory，选择项目文件夹。右上角会出现 Git 面板：勾选文件、Commit、Push / Pull。
- `npm` 命令在 Terminal 标签里运行。
- RStudio 能编辑 TypeScript，但没有类型检查和自动补全；以 `npm run build` 的报错为准。

## 在 Positron 中

- File → Open Folder，选择项目文件夹。左侧的 Source Control 视图负责暂存、提交、推送。
- 自带 TypeScript 补全和实时报错；终端里运行 `npm` 命令。
- 同一个窗口里也可以写 R 脚本分析导出的 CSV。

## 发布新版本

第一次发布前设置一次：

- Settings → Pages → Build and deployment 的 Source 选 **GitHub Actions**。
- Settings → Environments → `github-pages` → Deployment branches and tags：加一条规则，类型选 Tag，填 `v*`（发布是从标签运行的，默认只允许 `main`）。
- 在 Zenodo 用 GitHub 登录，头像菜单 → GitHub → Sync now，打开 LithicAnalyst 的开关。之后每次发布都会存档并给 DOI。

每次发布：

1. 修改 `package.json` 的 `version` 和 `CITATION.cff` 的 `version`、`date-released`；把 `CHANGELOG.md` 的 Unreleased 改成版本号和日期。提交并推送。
2. GitHub → Releases → Draft a new release：新建标签（如 `v0.2.0`），说明从 CHANGELOG 复制，Publish release。
3. 之后自动完成：Actions 里的 Release 把 `LithicAnalyst-0.2.0.html` 附到这次发布，并把在线版换成这个版本；Zenodo 存档并给这个版本一个 DOI。

在线版也可以在 Actions → Release → Run workflow 手动更新（用 `main` 的当前代码，不附文件）。

## 界面文字与翻译

界面上的所有文字都在 `src/ui/strings.ts`，字段和选项的标签在 `src/core/fields.ts`。整理、核对和翻译用一张表：

```bash
npm run i18n -- export                    # 生成 i18n/texts.xlsx：每行一条文字，每种语言一列
npm run i18n -- import i18n/texts.xlsx    # 把表里改过的文字写回源代码（--dry 只列出会改什么）
npm run i18n -- check                     # 只检查：占位符、空白、缺少或没用到的文字、同词异译
```

- 在 Excel 或 WPS 里直接改语言列的单元格，保存为 .xlsx；不要改 `id` 列。表里的「说明 readme」页写了规则。
- 加一种语言：在语言列后面加一列，表头写语言代码（`ja`、`ko`、`fr`、`de`、`es`、`pt-BR`、`zh-TW`……），在 `@lang.name`、`@lang.short` 两行写它自己的名称和语言按钮上的缩写，然后导入。没译的格子显示英文，可以分几次译完。
- `{n}`、`{name}` 这样的占位符每种语言都要保留；英文和中文不能留空。有错误时导入什么都不写，只列出错误。
- 导入后运行 `npm test`、`npm run build`。

## 约定

- 项目文件格式变化要同步更新 `docs/project-format.md` 和测试；旧文件读不对时要提高 `formatVersion`。
- 界面文字放在 `src/ui/strings.ts`，中英文都要写；界面保持精简，不放操作说明。批量修改和翻译用上面的 `npm run i18n`。
- 新增字段改 `src/core/fields.ts`，CSV 和界面会自动跟上。
