# 书房 Chat｜M1 缺失的建模资产

当前书房使用 `01-bookshelf/04_ProjectFolio_Reading.glb` 作为可单独查看的展开姿态，`01-bookshelf/05_Library_Register.glb` 是书架上的墨水屏管理书。中层左格可添书的绿布烫金封面为 `01-bookshelf/06_Binding_Seal.glb`，右格的电子书托座为 `01-bookshelf/07_Reader_Cradle.glb`。应用中的纸张曲率、实时排字、浮字、手势和界面由 `study-chat-m1` 的运行时代码驱动。

`04-avatar/White_Dress_Avatar.blend` 是白裙角色的可编辑工程。头发沿原来的侧分刘海和长披发轮廓重建。展开头发集合里的 `Hair guides`，点亮对应曲线的眼睛图标，即可在编辑模式里调整发束。姿态模式里的 `Hair • secondary motion` 骨骼集合分别控制脸侧、两肩和后背的发尾。`04-avatar/披发转头预览.mp4` 使用带骨骼版本演示转头和发梢跟随。`04-avatar/玩家角色.glb` 是带骨骼的书房版本，`04-avatar/White_Dress_Avatar.glb` 是静态展示版本。

下文是最初交付时的资产说明。这个包只补齐 `study-chat-m1-source.zip` 没有收录的新版模型，不包含或修改 M1 源码。模型还没有接进应用，解压不会自动替换原型里的道具。

- `01-bookshelf/`：书架、可开合项目书、装饰书（3 个 GLB）。PDF 和 JSON 里有书架插槽、开合动画、左右纸面的位置及尺寸。
- `02-window-desk/`：窗边桌、椅、开洞短墙、窗、日景及暮景背景（6 个 GLB）。TXT 里有装配位置、阅读相机、窗扇动画和天气层节点。
- `03-player/`：桌面播放器（1 个 GLB）。
- `04-avatar/`：当前最新版白裙角色，可编辑 Blender 工程。**暂未导出 GLB/VRM**。底模沿用 pixiv VRoid Project 的 CC0 Base_Female。
- `blender-sources/`：书架和书、窗边组、播放器的可编辑 Blender 源文件。

给本地 Codex 使用时，请把这个包解压到独立目录，再把目录交给它。优先使用 GLB 和同目录的装配说明；角色工程不需要直接放进应用的静态资源目录。模型仅是独立资产，播放器未接音乐服务，角色坐姿和翻页也未验收。
