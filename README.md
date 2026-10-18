# LithicAnalyst

开源石器三维分析交互平台。当前版本用于在三维模型上标注**片疤方向**和**曲线**（刃缘、棱脊、片疤边界等），并导出坐标数据。

![LithicAnalyst](docs/screenshot.png)

- 纯网页应用：打开 `dist/index.html` 即可使用，可离线；数据只在本机浏览器中处理。
- 导入 PLY / STL / OBJ，坐标保持文件原样。
- 画箭头：按下–拖动–松开，或单击起点、再单击终点；自动编号、自动保存、可撤销、可拖动端点修改。
- 每条箭头记录完整性（5 类）、方向可信度和备注。
- 画曲线：单击放点，点会吸附到附近的棱脊（凸）或凹谷（凹），点与点之间的线沿该特征自动走；也可关闭吸附。双击、Enter 或 Esc 完成，单击第一个点闭合；选择模式下可拖动点修改。
- 每条曲线记录类型（刃缘 / 棱脊 / 片疤边界 / 其他）和备注。曲线端点可吸附到已有曲线上（T 形交接），几条曲线能围成封闭区域。
- 表面区域（R）：曲线把表面分成若干块，曲线一变就重算；点击一块定类型（1 片疤、2 石皮、3 节理面、4 破损），以点击处为种子保存，重算后由包含种子的那块继承；片疤区域自动关联起点落在其中的箭头，否则新建一个无方向的片疤；两个种子落进同一块时提示冲突。计算各区域面积、各类型总面积和石皮比。
- 石皮拟合球（测量模式）：对选定的石皮区域（默认全部）的顶点做球面最小二乘拟合（代数解作初值，再几何迭代精化），给出半径、球心、残差 RMS，可显示线框球。
- 上下体积切分（测量模式，仅封闭模型）：按一条闭合曲线（如石核边缘）或一个拟合平面把模型分成两部分，分别给出体积；上侧 = 法向所指的一侧，可互换。
- 界面分「标注 / 测量 / 展示」三种模式，每种只显示自己的工具和侧栏。
- 测量模式：打开模型即自动算长、宽、厚（标本坐标系或面积加权主轴）、表面积、体积（仅封闭模型）、Surface-to-Volume Ratio、Wadell 球度；手动测量两点直线距离、沿表面距离、三点角度（编号 M1、M2……，可撤销，存入项目文件）。
- 拟合平面（测量模式）：全部顶点（Lin et al. 2024）、片疤方向（Xiao et al. 2026）、片疤起点（可按完整性筛选）、曲线；输入一变就重算；显示半透明圆盘、与模型的交线和法向，可翻转、沿法向观察、逐个显示 / 隐藏。
- 标本定向（展示模式）：以当前视角或某个平面的法向为正视方向，可用箭头定纵轴（起点在下）、左右转 90° 和微调；只记录变换矩阵，模型和标注坐标不变；设定后长宽厚按标本坐标系计算。
- 出图（展示模式）：正面、背面、左、右、上、下任选，按欧洲惯例（ISO 第一角投影）排版、同比例对齐；掠射光来自左上方，高度可调；叠加片疤箭头、曲线、平面交线、比例尺（逐项开关）。PNG 透明背景，按实物比例（1:2 / 1:1 / 2:1）和 300 / 600 / 1200 dpi 输出；SVG 以 mm 为单位，明暗为内嵌位图，箭头、曲线、交线、比例尺和外轮廓为矢量，被遮挡的部分不画。坐标单位未注明时没有比例尺，也不按实物比例。
- 截面（展示模式，X）：在屏幕上拖一条直线穿过模型，切面由这条线和视线方向确定；三维中可只保留一侧，剖面平涂或斜线填充；截面图单独导出 SVG / PNG，也可加进图版（放在视图右侧）。只用于展示，不输出测量值。
- 掠射光、曲率着色、浅色 / 深色背景。
- 导出 CSV 和项目文件（JSON，格式见 `docs/project-format.md`；旧版本的项目文件可直接打开，保存时转为新格式）。中文 / English 界面。

## 完整性分类 / Completeness codes

| 键 | 界面 | CSV 代码 |
|---|---|---|
| 1 | 可见打击点+尾端完整 | `point_complete` |
| 2 | 可见负向打击泡+尾端完整 | `bulb_complete` |
| 3 | 可见打击点+尾端缺失 | `point_truncated` |
| 4 | 可见负向打击泡+尾端缺失 | `bulb_truncated` |
| 5 | 两端缺失 | `both_missing` |

## 快捷键 / Shortcuts

M 切换模式（标注 / 测量 / 展示）· A 画箭头 · P 画曲线 · R 表面区域 · D / G / N 测距离 / 沿表面 / 角度 · X 画截面 · V 选择 · S 吸附：凸 / 凹 / 关 · 按住 Shift 放点时不吸附 · Enter 完成曲线 · Backspace 删除上一个点 ·
1–5 完整性 / 曲线类型 · Delete 删除 · [ ] 上一条 / 下一条 · Ctrl+Z / Ctrl+Shift+Z 撤销 / 重做 ·
Ctrl+S 保存项目 · H 全视图 · C 光标处设为旋转中心 · 按住 L 调光 · 按住空格用左键旋转 · Esc 取消 / 完成曲线

## 数据 / Data

CSV（每条箭头一行，坐标为模型文件原始坐标）：

```
specimen_id,scar_id,start_x,start_y,start_z,end_x,end_y,end_z,length,completeness,certainty,note,unit
```

曲线 CSV（每个点一行，按曲线上的顺序；`arc_length` 为沿曲线到该点的距离，`anchor` 标出手动放的点）：

```
specimen_id,curve_id,point_index,x,y,z,arc_length,anchor,closed,length,type,note,unit
```

测量 CSV（每件一行；体积相关的值在模型不封闭时留空）：

```
specimen_id,unit,frame,length,width,thickness,surface_area,volume,surface_to_volume_ratio,wadell_sphericity,closed,area_scar,area_cortex,area_joint,area_damage,cortex_ratio,nodule_radius,nodule_fit_rms,volume_upper,volume_lower,volume_ratio
```

手动测量 CSV（每条一行；用不到的点留空，角度单位为 `deg`）：

```
specimen_id,measure_id,type,value,unit,p1_x,p1_y,p1_z,p2_x,p2_y,p2_z,p3_x,p3_y,p3_z
```

拟合平面 CSV（每个平面一行；m00 … m33 为行主序 4×4 矩阵，把原始坐标变换到平面坐标系；无效平面的数值留空）：

```
specimen_id,plane_id,method,center_x,center_y,center_z,normal_x,normal_y,normal_z,m00,m01,…,m33
```

表面区域 CSV（每个区域一行；scar_id 为所属片疤编号，面积单位为坐标单位²）：

```
specimen_id,region_id,type,scar_id,area,unit
```

测量 CSV 另有 `area_scar,area_cortex,area_joint,area_damage,cortex_ratio`（表面区域）、`nodule_radius,nodule_fit_rms`（石皮拟合球）和 `volume_upper,volume_lower,volume_ratio`（上下体积切分）。

## License

MIT
