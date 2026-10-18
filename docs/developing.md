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

推送到 `main` 后，GitHub Actions 会自动跑测试；启用 Pages 后还会自动更新网页。

## 在 RStudio 中

- File → New Project → Existing Directory，选择项目文件夹。右上角会出现 Git 面板：勾选文件、Commit、Push / Pull。
- `npm` 命令在 Terminal 标签里运行。
- RStudio 能编辑 TypeScript，但没有类型检查和自动补全；以 `npm run build` 的报错为准。

## 在 Positron 中

- File → Open Folder，选择项目文件夹。左侧的 Source Control 视图负责暂存、提交、推送。
- 自带 TypeScript 补全和实时报错；终端里运行 `npm` 命令。
- 同一个窗口里也可以写 R 脚本分析导出的 CSV。

## 发布新版本

1. 修改 `package.json` 里的 `version`，并在 `CHANGELOG.md` 写上变化。
2. 提交后打标签并推送：

   ```bash
   git tag v0.2.0
   git push --tags
   ```

3. 在 GitHub 的 Releases 页面基于这个标签创建发布，附上 `dist/index.html`。

## 约定

- 项目文件格式变化要同步更新 `docs/project-format.md` 和测试；旧文件读不对时要提高 `formatVersion`。
- 界面文字放在 `src/ui/strings.ts`，中英文都要写；界面保持精简，不放操作说明。
- 新增字段改 `src/core/fields.ts`，CSV 和界面会自动跟上。
