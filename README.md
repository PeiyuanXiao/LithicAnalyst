# LithicAnalyst

开源石器三维分析交互平台：在三维模型上标注**片疤方向**、**曲线**（刃缘、棱脊、片疤边界等）、表面区域、打破关系与剥片序列、地标，做测量和出图，比较不同标注者，并可批量处理整个文件夹；导出坐标与测量数据。

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
- 打破关系与剥片序列（标注模式，B）：依次点两个片疤（箭头或区域），记录「A 打破 B」（A 晚于 B）、「B 打破 A」或「无法判断」（与「还没判断」区分保存）；侧栏可修改、删除。新建序列（Q1、Q2……）并排定先后，在片疤检查器里把片疤归入序列，序列内部可排先后。实时检查打破关系成环、与序列先后矛盾、与序列内部先后矛盾、片疤未归入序列，以计数显示，点开列出明细并在三维中高亮涉及的片疤。Harris 矩阵面板（晚的在上，只画直接关系，成环的边标红，按序列框起）随标注实时更新，点击节点选中片疤，可导出 SVG。「按剥片序列」配色：箭头和片疤区域按序列着色，序列内由浅到深表示先后。
- 地标（标注模式，K）：在表面上点选固定地标（按吸附设置吸附到附近的棱脊 / 凹谷，按住 Shift 不吸附），可拖动移动、自由命名；列表顺序即导出顺序，可拖动行或用上移 / 下移调整。可「沿用上一件的点名」：之后点选时依次套用，可跳过。曲线半地标：选一条曲线和点数 N，可指定起止固定地标，沿曲线等弧长取点，曲线或地标一变就更新。导出 TPS（LM3）、3D Slicer `.fcsv`、长格式 CSV 和滑动定义 CSV（geomorph `curves` 格式），四者点序一致；滑动在 R 中完成。出图可叠加地标。
- 观察者间一致性（比较模式）：载入同一模型（SHA-256 一致）的其他项目文件，与当前项目一起比较，各标注者用不同颜色叠加显示。箭头和曲线按距离做最优配对（匈牙利算法，配对距离上限可调），平面按方法、地标按名称、半地标按组和序号、区域按三角面比较；给出方向夹角、起止点距离、未配对数、曲线平均对称距离和 Hausdorff 距离、平面法向夹角和中心距离、区域 IoU / Dice、片疤属性 / 区域类型 / 打破关系的一致率和 Cohen's κ（三人及以上另给 Fleiss' κ）、地标距离和测量差值。导出长格式明细表和汇总表。
- 文件夹与批量处理：「打开文件夹」读取一个文件夹中的模型和项目文件，可上一件 / 下一件（PageUp / PageDown）切换。Chrome / Edge 中项目文件自动保存在模型旁边（`<模型名>.lithicanalyst.json`）；其他浏览器只能读，结果逐个下载。「批量计算」对全部模型计算自动测量并汇总项目文件中的派生指标，各类 CSV 各合并成一份（另有合并的 TPS），一件模型有多位标注者的项目文件时另给各测量值的 ICC(2,1)；「批量出图」用同一套展示设置导出全部标本的图（PNG / SVG）。一件一件处理，显示进度，可以取消。
- 界面分「标注 / 测量 / 展示 / 比较」四种模式，每种只显示自己的工具和侧栏。
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

M 切换模式（标注 / 测量 / 展示 / 比较）· A 画箭头 · P 画曲线 · R 表面区域 · B 打破关系 · K 地标 · D / G / N 测距离 / 沿表面 / 角度 · X 画截面 · V 选择 · S 吸附：凸 / 凹 / 关 · 按住 Shift 放点时不吸附 · Enter 完成曲线 · Backspace 删除上一个点 ·
1–5 完整性 / 曲线类型 · Delete 删除 · [ ] 上一条 / 下一条 · Ctrl+Z / Ctrl+Shift+Z 撤销 / 重做 ·
Ctrl+S 保存项目 · PageUp / PageDown 文件夹中的上一件 / 下一件 · H 全视图 · C 光标处设为旋转中心 · 按住 L 调光 · 按住空格用左键旋转 · Esc 取消 / 完成曲线

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

打破关系 CSV（每条关系一行；片疤用编号；relation 为 `a_cuts_b`（scar_a 晚于 scar_b）或 `indeterminate`（无法判断））：

```
specimen_id,scar_a,scar_b,relation
```

剥片序列 CSV（序列中的每个片疤一行；series_order 从最早的序列起为 1；order_in_series 从最早的片疤起为 1，序列内未排先后时留空）：

```
specimen_id,series_id,series_order,scar_id,order_in_series
```

地标（四个文件点序相同：先固定地标（列表顺序），再按组列出各组半地标，序号从 1 起）：

- `<标本>_landmarks.tps`：`LM3=点数`，每点一行 `x y z`，末行 `ID=标本编号`；
- `<标本>_landmarks.fcsv`：3D Slicer 标记点文件（LPS，坐标同模型文件）；
- `<标本>_landmarks.csv`：

```
specimen_id,index,name,kind,set_id,x,y,z
```

- `<标本>_sliders.csv`：滑动定义（geomorph `curves` 格式，用上面的序号）：

```
before,slider,after
```

一致性明细 CSV（比较模式；每个数值一行，三人及以上时 Fleiss' κ 的 annotator_a 为 `all`）和汇总 CSV：

```
specimen_id,item_type,item_key,annotator_a,annotator_b,metric,value
specimen_id,item_type,metric,annotator_a,annotator_b,n,mean,sd,min,max
```

批量计算的输出以文件夹名开头：`<文件夹>_measurements.csv`（每件一行）以及其他各类合并后的 CSV、`<文件夹>_landmarks.tps`；有多位标注者时另有 `<文件夹>_icc.csv`：

```
measure,n_specimens,n_raters,icc
```

测量 CSV 另有 `area_scar,area_cortex,area_joint,area_damage,cortex_ratio`（表面区域）、`nodule_radius,nodule_fit_rms`（石皮拟合球）和 `volume_upper,volume_lower,volume_ratio`（上下体积切分）。

## License

MIT
