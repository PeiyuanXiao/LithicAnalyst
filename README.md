# LithicAnalyst

开源的石器三维标注平台。当前版本用于在三维模型上标注**片疤方向**并导出坐标数据。
An open-source 3D annotation platform for lithic artefacts. The current version records
flake scar directions as arrows on a mesh and exports their coordinates.

![LithicAnalyst](docs/screenshot.png)

- 纯网页应用：打开 `dist/index.html` 即可使用，可离线；数据只在本机浏览器中处理。
- 导入 PLY / STL / OBJ，坐标保持文件原样。
- 画箭头：按下–拖动–松开，或单击起点、再单击终点；自动编号、自动保存、可撤销、可拖动端点修改。
- 每条箭头记录完整性（5 类）、方向可信度和备注。
- 掠射光、曲率着色、浅色 / 深色背景。
- 导出 CSV 和项目文件（JSON）。中文 / English 界面。

## 完整性分类 / Completeness codes

| 键 | 界面 | CSV 代码 |
|---|---|---|
| 1 | 可见打击点+尾端完整 | `point_complete` |
| 2 | 可见负向打击泡+尾端完整 | `bulb_complete` |
| 3 | 可见打击点+尾端缺失 | `point_truncated` |
| 4 | 可见负向打击泡+尾端缺失 | `bulb_truncated` |
| 5 | 两端缺失 | `both_missing` |

## 快捷键 / Shortcuts

A 画箭头 · V 选择 · 1–5 完整性 · Delete 删除 · [ ] 上一条 / 下一条 · Ctrl+Z / Ctrl+Shift+Z 撤销 / 重做 ·
Ctrl+S 保存项目 · H 全视图 · C 光标处设为旋转中心 · 按住 L 调光 · 按住空格用左键旋转 · Esc 取消

## 数据 / Data

CSV（每条箭头一行，坐标为模型文件原始坐标）：

```
specimen_id,scar_id,start_x,start_y,start_z,end_x,end_y,end_z,length,completeness,certainty,note,unit
```

项目文件格式见 [docs/project-format.md](docs/project-format.md)。

## 开发 / Development

需要 Node.js 20 以上。Requires Node 20+.

```bash
npm install
npm run dev      # 本地开发服务器，改代码即时刷新
npm test         # 单元测试
npm run build    # 类型检查并生成 dist/index.html（单文件）
```

- 代码结构与扩展方式：[docs/architecture.md](docs/architecture.md)
- 日常开发、提交与发布流程（含 RStudio / Positron）：[docs/developing.md](docs/developing.md)

推送到 `main` 分支后，GitHub Actions 会自动测试，并把网页发布到 GitHub Pages（需在仓库设置中启用一次）。

## License

MIT
