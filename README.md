# 河畔塔楼 · 微缩城市施工沙盘 (Riverside Tower Construction Diorama)

Three.js 可扩展的 Web 3D 微缩施工沙盘 Vertical Slice：桌面上的城市模型 + 蓝图背景，等距/45° 俯视，
真实楼层生长（非 scaleY）、塔吊吊运循环、车辆路网行驶、工人状态机、昼夜天气与时间轴回溯。

> ⚠️ **路径说明**：目标路径 `D:\deepseek\city-sandbox` 在本会话中**整个 D 盘为只读**（ACL 拒绝一切写入，
> 新建目录、写文件、npm install 全部失败）。工程因此建在可写位置：**`C:\Users\lu\Desktop\city-sandbox`**。
> 把整个目录复制到 `D:\deepseek\city-sandbox` 即可得到目标路径下的完整工程（无绝对路径依赖）。

---

## 快速开始

> ⛔ **不要双击 `index.html`**。`file://` 协议下浏览器会以 CORS 策略阻止 ES 模块加载
> （`origin` 为 `null`，报 `Access to script ... has been blocked by CORS policy`），
> `src/app.js` 根本不会执行，页面只会停在一个空白的启动画面上。
> 本项目用 ES 模块 + `fetch` 读取 `config/*.json`，**两者都要求 http(s) 协议**。
> 页面已内置检测：用 `file://` 打开时会直接给出下面这些解决方式，而不是静默黑屏。

```bash
cd C:\Users\lu\Desktop\city-sandbox
npm install          # 仅用于本地 vendor 与 node 侧测试（three@0.169）
npm start            # 启动零依赖静态服务器 -> http://127.0.0.1:5173/
```

浏览器打开 `http://127.0.0.1:5173/`。Three.js 已 vendor 到 `public/vendor/three.module.js`，
通过 importmap 解析，**完全离线可运行**（无 CDN 依赖）。

### 四种启动方式

| 方式 | 操作 | 端口 | 适用 |
|---|---|---|---|
| **双击启动器** | 双击项目根的 `start-server.cmd` | 5173 | 最快，无需开编辑器 |
| **npm** | `npm start` | 5173 | 命令行习惯 |
| **VS Code 调试** | `F5` → 「▶ 启动沙盘服务器 (5173)」 | 5173 | 需要断点调试 Node 侧 |
| **VS Code Live Server** | 右下角 `Go Live` / 右键 html → Open with Live Server | 5500 | **改前端代码存盘即自动刷新** |

后两种可同时运行，端口不冲突。详见下文「在 VS Code 里运行」。

### 无头自检（不需要浏览器/GPU）

```bash
npm run check              # 38 项断言，覆盖楼层生长、塔吊循环、工人状态机、昼夜、天气、镜头
node tools/simtest.mjs --seconds 600 --verbose
node tools/validate.mjs    # 语法 + 编码 + 配置 + 自检 全套校验
```

### 调试用 URL 参数

```
?day=9&minute=1110&speed=6&weather=rain&camera=tower&paused=1&ui=0&debug=1&cinematic=1&fov=40
```

| 参数 | 作用 |
|---|---|
| `day` / `minute` | 直接跳到某施工日 / 某时刻 |
| `speed` / `paused` | 播放速度 / 暂停 |
| `weather` | `clear` `overcast` `rain` `snow` `fog` |
| `camera` | 机位预设 id（见 UI 镜头面板） |
| `theta` `phi` `radius` | 显式指定球坐标机位（会覆盖 `camera` 预设） |
| `ui=0` `debug=1` `cinematic=1` | 隐藏界面 / 开启 F2 调试 / 电影模式 |
| `shadows=0` `env=0` `sky=off` | 诊断旁路：逐项关闭阴影 / 环境贴图 / 天空穹顶 |
| `adaptive=0` | 关闭自适应分辨率 |

> 注意：在 PowerShell 里传含 `&` 的 URL 时会把参数截断，请先把 URL 存进变量再传给命令，
> 或直接在浏览器地址栏输入。

---

## 在 VS Code 里运行

工程已带完整编辑器配置，装上 VS Code 后打开项目文件夹即可用。

### 方式一：F5 调试（推荐调 Node 侧）

1. 左侧活动栏点 **运行和调试**（虫子图标）或按 `Ctrl+Shift+D`
2. 顶部下拉选 **「▶ 启动沙盘服务器 (5173)」**
3. 按 `F5` —— 集成终端打印服务地址后，VS Code 自动打开浏览器

其它现成配置：`🧪 无头自检`、`🎨 渲染链路截图验证`、`🌗 昼夜光照曲线`，
以及组合 **「▶▶ 服务器 + 自检」** 一次跑两个。

### 方式二：Live Server（推荐调前端）

装扩展 `ritwickdey.LiveServer`，然后任选：

- 右下角状态栏点 **`Go Live`**
- 右键 `index.html` → **`Open with Live Server`**
- `Alt+L` 再 `Alt+O`
- `Ctrl+Shift+P` → `Live Server: Open with Live Server`

浏览器打开 `http://127.0.0.1:5500/`，**改动 `src/` 下任何文件存盘即自动刷新**。

`.vscode/settings.json` 里已锁定 `port: 5500`（避开 node 服务器的 5173，两者可同时跑）
和 `root: "/"`（必须为项目根，否则 `config/`、`src/`、`public/vendor/` 会 404）。

### 方式三：任务

`Ctrl+Shift+B` 直接起服务器；`Ctrl+Shift+P` → `Tasks: Run Task` 可选
`sim-check` / `capture-render` / `validate-all`。

### 一条命令全量校验

```bash
node tools/validate.mjs          # 语法 + 编码 + 配置 + 自检
node tools/validate.mjs --fast   # 跳过自检
```

---

## 操作

| 按键 | 功能 |
|---|---|
| `Space` | 播放 / 暂停 |
| `← →` | 时间轴前进 / 后退 1 天 |
| `[ ]` | 播放速度 0.5x ~ 20x |
| `1`–`9` | 镜头预设（全景/主楼/街道/堆场/塔吊/大门/游览/跟随/电影） |
| `O` | 自动环绕开关 |
| `W` | 循环切换天气 |
| `F2` | 路网 / 航点 / 路径 / 包围盒 / 性能面板 |
| `F9` | 电影模式（隐藏界面 + 遮幅） |
| `H` / `M` | 隐藏界面 / 静音 |
| 鼠标 | 左键旋转 · 右键平移 · 滚轮缩放 |

---

## 架构

```
index.html  styles/ui.css
config/            scene.json · weather.json · lighting.json    ← 全部数据驱动
src/
  core/            Engine · SceneManager · EntityManager · AssetManager · EventBus
  lib/             three(封装) · materials(MaterialKit/InstanceBatch/GeometryBatch)
                   merge(顶点色合并) · orbit(自研控制器) · fsm · mathx · noise · rng · helpers
  world/           WorldBuilder(桌面/蓝图/场地/环路/围挡/道具) · Props(程序化道具库) · WaypointGraph + NavGrid
  entities/        BuildingEntity · CharacterEntity · VehicleEntity · CraneEntity · LightEntity · EntityFactories
                   chars/(CharacterModel + AnimationLibrary) · vehicles/(VehicleModel)
                   cranes/(CraneModel) · lights/(LightModels)
  systems/         Time · Construction · Vehicle · Character · Crane · Lighting · Weather
                   Camera · Audio · LightRig
  ui/              UISystem · Panels · Timeline · Toast · dom
  World.js         组装全部系统与实体，固定步长推进（可无头运行）
  app.js           引导：配置 → 世界 → 引擎 → UI
tools/             server.mjs(零依赖静态服务器) · simtest.mjs(无头断言) · diag-light.mjs · fiximports.mjs
```

### 核心设计

**真实楼层生长（禁止 scaleY）**
`ConstructionSystem` 把虚拟时钟换算成施工状态（各工序进度、已完成层数、脚手架区间、当前作业层）。
`BuildingGeometry` 按"每个开间一块楼板 + 固定截面柱 + 固定模数幕墙"重建几何，
楼板按浇筑顺序逐块出现，因此是**几何真增长**：Day1 308 块构件 → Day16 1245 块。
每层楼板/柱/梁/墙/幕墙/脚手架都是**同尺寸实例**，用 `InstancedMesh` 批处理：

| 阶段 | 楼层 | 构件数 |
|---|---|---|
| Day 1 | 3F | 308 |
| Day 5 | 4F | 526 |
| Day 9 | 9F | 967 |
| Day 13 | 12F | 1200 |
| Day 16 | 12F + 竣工 | 1245 |

**性能**：静态世界合并为 23 个 InstancedMesh / 33k 三角；建筑本体按材质 6 个 InstancedMesh；
所有车灯/路灯/警示灯光晕合并为 1 个加性 billboard `LightRig`；仿真 0.03 ms/tick（留足渲染预算）。

**状态机驱动 + 动画与模型分离**
实体状态机：工人 `IDLE/WALK/WORK/CARRY/TALK/REST`、车辆 `DRIVE/WORK/IDLE`、
塔吊 `HOME/PICK/LIFT/SLEW/TROLLEY/LOWER/RELEASE/RETURN`。
动画库 (`AnimationLibrary`) 只操作 Group 枢轴，与模型几何解耦 —— 换成 GLB 骨骼只需重写这 5 个函数。

**AssetManager 接口可替换**
所有程序化占位都注册为可寻址资产 id（`prop.cone`、`crane.load.rebar`、`character.worker`…）。
接入真实 GLB 时用同名 id 注册 loader 工厂即可，实体代码零改动。

---

## 已知取舍（诚实清单）

1. **垂直交通未建模**：工人到达主楼投影范围后，`getFloorHeight()` 以阻尼抬升到作业层（沙盘尺度下读作"上楼"），
   没有建楼梯/施工电梯。要严格做到"不穿墙爬楼"需补 nav 分层图 + 爬升动画。
2. **LOD 未启用**：当前预算下（33k 静态三角）无需 LOD；`InstanceBatch`/`GeometryBatch` 已按批处理组织，
   接大模型时再挂 `THREE.LOD` 即可。
3. **`characterSystem.js` / `vehicleSystem.js` / `craneSystem.js` 未单独建文件**：这三类逻辑分别落在
   实体自身状态机 + `World.pickTask/completeTask` 任务调度里，是为了避免"系统只转发调用"的空壳层。
   若你要求严格的十系统目录结构，我可以拆出薄封装层。
4. **音频为程序化合成**：WebAudio 噪声床（风/雨/工地底噪）+ 事件音（锤击/落料/倒车提示），无音频文件。
5. **浏览器实拍验证**：无头 Edge 的 GPU 截图通道在本机不可信（`glError 1286` 帧缓冲不完整），
   因此改用**渲染到 RenderTarget 再读回像素**的方式验证，见下方验证记录与 `.verify/` 目录。

---

## 验证记录

```
$ npm run check                     # 无头断言（不需要浏览器/GPU）
=== build ===              world built in 89 ms
=== structure ===          31 entities / 10 workers / 2 cranes / 7 vehicles
=== construction ===       day 1 -> 3F ... day 16 -> 12F (complete)  boxes 308 -> 1245
=== scrub ===              12d(11F) -> 4d(3F) -> 12d(11F)  ✓ 可回溯
=== behaviour ===          crane: PICK/LIFT/SLEW/TROLLEY/LOWER/RELEASE/RETURN/HOME
                           workers: WALK/WORK/IDLE/CARRY/TALK   10/10 walked > 1.5m
=== weather ===            clear/overcast/rain(5200 drops)/snow(4200 flakes)/fog
=== lighting ===           01:00 night=0.99 street=ON | 12:00 night=0.00 sunY=0.94
=== camera ===             diorama/autoOrbit/streetTour/follow/flyover 全部有限坐标
=== performance ===        0.03 ms/tick, 23 draw batches, 33k static triangles
ALL 38 CHECKS PASSED
```

```
$ node tools/render-target-capture.mjs --day 10 --minute 700 --out .verify/bright.png
mean=89  nonBlackPct=100  colouredPct=45.9  calls=232  triangles=250956  floors=11
sun=3.23 sunY=0.865 hemi=0.95 ambient=0.42 exposure=1.22 toneMapping=ACESFilmic
workers: WALK x10       cranes: PICK, PICK
```

---

## 已修复的关键缺陷（含排查方法）

| 缺陷 | 根因 | 修复 |
|---|---|---|
| **整个画布全黑（应用未启动）** | 用 PowerShell `Set-Content` 改写 `src/app.js` 时破坏了 UTF-8 中文串，产生语法错误 → 模块加载失败，一个启动步骤都没执行 | 用无损写入重造文件；扫描确认全仓无残留损坏 |
| **建筑渲染为纯黑** | 建筑批次与静态世界**共用材质实例**，该材质的 shader 变体是为"带顶点色的合并几何体"编译的，而建筑用的是无 `color` 属性的 UnitBox 实例网格 | 每个批次使用独立材质（`vertexColors: false`）；`mergeGeometries` 为缺失的法线/颜色补兜底值，避免零填充属性 |
| **天空完全不渲染** | 穹顶被放到 `layers.set(4)`，而相机只渲染第 0 层 | 穹顶回到默认层 |
| **天空位置错误（画面混入穹顶"地面色"）** | `LightingSystem` 从未收到相机位置，穹顶停在场地中心，与相机偏心 80m | `World` 每帧把相机位置交给光照系统，并把相机更新提到光照之前 |
| **天空呈现泥褐色** | 穹顶位于雾 far 之外，被整片雾色吞掉 | 穹顶材质 `fog = false` |
| **阴影投到错误位置** | 太阳方位接近垂直时 `DirectionalLight` 的 lookAt 前向与 up 退化 | 太阳方向保留最小水平分量 |
| **白天整体偏暗** | 白天 palette 的 ambient 过低（`#6d7c96 @0.18`） | 正午 ambient → `#8fa3bd @0.42`、hemi → `0.95`、exposure → `1.22` |

### 自查工具（均在 `tools/`）

```bash
node tools/simtest.mjs --seconds 600 --assert          # 38 项无头断言
node tools/render-target-capture.mjs --day 10 --minute 700 --out out.png
node tools/probe-scene.mjs --gpu                       # 页面内探针 + 启动状态
node tools/diag-light.mjs                              # 昼夜光照曲线
node tools/server.mjs --port 5173                      # 静态服务器
```

打开 `?debug=1` 后**调试面板会显示 GPU 型号与着色器编译状态**；若某材质在当前驱动上编译失败，
页面顶部会弹出红色告警并打印 GPU 信息，而不是静默黑屏。可用 `?shadows=0&env=0&sky=off` 逐项旁路定位。


<!-- push capability verified: 2026-09-23 10:18:08 -->
