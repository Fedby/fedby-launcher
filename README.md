# Fedby 启动器

一个对标 PCL2 的 Minecraft Java 版启动器，基于 Electron + Node.js，独立管理自己的游戏目录。

> 当前版本 **v1.0.0**（首个发行版）。架构为「主进程服务层 + 渲染层模块化」，功能覆盖启动、版本安装、双源下载、三种登录、设置与主题。

## 快速开始

**双击 `启动启动器.bat`** 即可运行（脚本已处理环境变量冲突）。

首次运行前需安装依赖（项目已装好，换机器时需执行）：
```bash
npm install
```

命令行启动（需清除环境变量）：
```bash
set ELECTRON_RUN_AS_NODE=
set NODE_OPTIONS=
npm start
```

## 打包成 exe

```bash
npm run dist            # 同时产出安装版 + 便携版
npm run dist:portable   # 只产便携版
```

产物在 `dist/`：

| 文件 | 说明 |
|---|---|
| `FedbyLauncher-Setup-1.0.0.exe` | 安装版（98 MB）：可选安装目录、创建桌面与开始菜单快捷方式，同名快捷方式为「Fedby 启动器」 |
| `FedbyLauncher-Portable-1.0.0.exe` | 便携版（90 MB）：单文件免安装，双击即用 |
| `win-unpacked/` | 解包目录，便于排查问题（`FedbyLauncher.exe` 可直接运行） |

图标为 `build/icon.png`（512×512），打包时自动生成 7 个尺寸的 ICO（16/24/32/48/64/128/256）。替换图标就把图片覆盖到 `build/icon.png`，或用 `electron tools/convert-icon.js <源图> build/icon.png 512` 转换。

打包后仍然读写 `%APPDATA%\FedbyLauncher`，与 `npm start` 完全共用同一份配置、账户与游戏目录，换机器拷走 exe 后首次运行会重新扫描 Java。

未配置代码签名证书，Windows 首次运行可能提示「未知发布者」，选择「更多信息 → 仍要运行」即可。

## 已实现功能

| 模块 | 功能 |
|---|---|
| **启动** | **账户完全融入主页**（PCL2 风格头像条 + 完整账户列表/切换/删除/三种登录方式）、版本选择、**自动选择 Java / 自动分配内存**（可一键关闭改为手动）、内存滑杆、实时日志、启动/停止 |
| **版本管理** | 本地版本列表、从 Mojang 官方下载安装（含资源与依赖库、SHA1 校验、并发下载）、**「检查」弹窗（基本信息/模组/资源包/光影/存档五标签，每个标签都有「打开文件夹」，基本信息页还提供版本目录、游戏根目录、模组、资源包、光影、存档、备份的快捷入口）**、行内「📁 目录」直达版本文件夹、选用/删除 |
| **下载中心** | **Modrinth + CurseForge 双源**搜索，7 种资源（模组/整合包/资源包/光影/地图/插件/数据包）；**⭐ 热门模组推荐**；名称为中文、原名作副标题；**MC 版本为下拉选择：全版本 / 已安装 / 常用版本 / 自定义输入**；安装弹窗内可按 **游戏版本 + 加载器 + 关键词** 三重筛选并逐条挑选文件（默认自动匹配当前版本，标注「匹配 XX」）；依赖自动安装、实时进度、重复安装跳过、项目主页直达 |
| **账户** | 离线账户（稳定 UUID）、**微软正版登录（内置微软官方登录窗口，登录后自动同步皮肤头像）**、**第三方皮肤站登录（Yggdrasil / LittleSkin / Blessing Skin）**，皮肤头像在启动器内直接显示并可手动同步 |
| **设置 → Java 运行时** | 自动扫描常见安装位置、按主版本识别、选用/浏览指定 `java.exe`；26.x 需要 Java 25 |
| **设置** | **智能启动开关**（自动 Java / 自动内存）、**主题颜色（8 种预设 + 自定义取色，即时预览）**、第三方皮肤站地址与 authlib-injector.jar、Java 运行时、内存/分辨率/全屏、额外 JVM 与游戏参数、下载并发数、社区中文数据开关、CurseForge API Key、数据目录 |

## 数据存储

所有数据位于 `%APPDATA%\FedbyLauncher\`：
- `config.json` — 全局配置
- `accounts.json` — 账户列表
- `minecraft/` — 游戏主目录（versions / libraries / assets / natives，实例已取消，全部版本共用）
- `skins/` — 第三方皮肤站同步的皮肤贴图
- `backups/` — 存档备份

当前已导入桌面 `MyLauncherTest` 中备齐的 Minecraft 26.3 原版素材（约 770MB），打开即可直接启动。

## 技术说明

- 架构为「主进程服务层 + 渲染层模块化」两层：主进程按职责切成 `services/{paths,settings,net,versions,java,runtime,launch,content,accounts,microsoft,yggdrasil,i18n,providers}`，`bridge.js` 只做 IPC 路由，不含业务逻辑；渲染层用原生 ES Module + 自建极简路由（`registerPage / navigate / rerender`）。
- 渲染层通过自定义协议 `fedby://app/index.html` 加载（`protocol.registerSchemesAsPrivileged` + `protocol.handle`，带 CSP 头），因此可以直接使用 `import`，无需打包器；`resolveAsset()` 带路径越界校验。
- IPC 统一包成 `{ ok: true, data }` / `{ ok: false, error }`，渲染层 `call()` 负责解包与抛错；同时会剔除 `ipcMain.handle` 的事件首参，业务函数只收到真实参数。
- 26.3 使用新式库结构：natives 作为带 classifier 后缀的独立 library 条目，靠 `rules` 按平台筛选后全部进 classpath（LWJGL 3.4 直接从 jar 加载原生库）。
- 启动命令由 `src/main/services/launch.js` 动态构建，解析 `arguments.jvm` / `arguments.game` 的规则与占位符（`${key}` 显式替换 + rules/features 筛选）。
- 微软登录走 **live.com 授权码流程**（与 PCL2 相同）：内置 `BrowserWindow`（`persist:microsoft-login` 分区复用登录状态）打开微软官方登录页，用 `webRequest.onBeforeRequest` 拦截 `oauth20_desktop.srf?code=…` 回调取授权码，再换令牌 → Xbox Live → XSTS（XErr 有中文提示）→ `login_with_xbox` → 档案与皮肤。**不再使用设备码**：`/devicecode` 端点要求每个启动器自有且经 Mojang 审批的 Azure 应用，官方启动器的公开 client id 在 consumers 租户已不存在（AADSTS700016），旧实现因此拿不到任何验证码。登录信息含 `refreshToken`，启动前令牌临近过期会静默续期。
- 第三方皮肤站走标准 Yggdrasil 认证：`POST /api/yggdrasil/authserver/authenticate`，再从 `/api/yggdrasil/minecraft/profile/{uuid}` 取 `textures` 属性（Base64 PNG 链接），下载到 `skins/` 并在界面绘制皮肤头部。若在设置里指定 `authlib-injector.jar`，启动皮肤站账户时会自动加 `-javaagent`，让游戏内皮肤也生效。
- 自动选择 Java：读取版本 JSON 的 `javaVersion.majorVersion`，从扫描结果中挑「满足要求且版本最低」的 Java（无满足项则退回最高版本）；自动内存为物理内存 1/4，限制 2~8 GB。均可在设置或启动页关闭。
- 中文数据不再用通用机翻（避免 Sodium 被译成「钠含量较高」这类雷人结果）。名称按 **人工校对词库 → MC百科 → 麦块社区 → 英文原名** 依次取值：常见模组（Create 机械动力、JEI 物品管理器、苹果皮等）用内置词库，保证稳定准确；词库未收录时查 MC百科的正式中文名；百科确认没有中文名就老实保留英文，不硬造译名。描述优先用 **MC百科的中文原创简介**，其次 MCIM 社区 LLM 翻译，并过滤版本公告等无关内容。首屏 16 条 + 磁盘缓存，设置里可整体关闭。
- CurseForge 使用社区公开的 API Key（Prism/HMCL 通用），可在设置里填入自己的 key（`console.curseforge.com` 免费申请）。部分 CF 模组禁止直链下载，会提示到官网手动下载。
- 界面窗口 1060×700（最小 900×600），**顶部分页放大并水平居中**（启动 / 版本 / 下载 / 设置）；页面切换、导航下划线、卡片悬浮、按钮按压、弹窗、Toast、日志、启动按钮呼吸光均有过渡动效；主题色写入 `--primary` 等 CSS 变量即时生效，派生色用 `color-mix` 计算。
- 已取消「实例」：所有版本共用 `%APPDATA%\FedbyLauncher\minecraft` 作为游戏目录；模组/资源包/光影/存档统一在「版本管理 → 检查」中查看与管理，每个标签都能直接打开对应文件夹。Java 配置移入设置页。
- CurseForge 版本列表分页拉取（最多 200 个文件），避免「全版本」只看到最近 50 条而选不到旧版本文件。
- `启动启动器.bat` 必须为纯 ASCII + CRLF（UTF-8 中文注释 + LF 会被 cmd 解析成乱码命令）。使用直接调用而非 `start`，已实测可正常启动；console 窗口会伴随启动器存在。

## 项目结构

```
src/
  main/                      主进程（Electron）
    index.js                 窗口创建、fedby:// 协议、CSP、外链拦截
    bridge.js                全部 IPC 注册（只做路由与错误包装）
    services/
      paths.js               目录定义、确保存在、旧数据自动迁移
      settings.js            配置默认值、白名单 patch、数值收敛
      net.js                 请求/JSON/下载（重定向、.part + SHA1 校验、并发池）
      versions.js            版本列表/详情/Mojang 安装（jar + 库 + 资源）
      java.js                Java 扫描、探测、主版本解析、推荐内存
      runtime.js             「版本要求 → Java 路径 + 内存」推荐
      launch.js              启动命令构建、进程管理、日志流
      content.js             模组/资源包/光影/存档/备份
      accounts.js            账户 CRUD、离线 UUID、皮肤文件与 dataURL
      microsoft.js           微软 OAuth 授权码流程 + XSTS + 皮肤缓存
      yggdrasil.js           第三方皮肤站认证与皮肤同步
      i18n.js                中文名/简介：词库 + MC百科 + MCIM + 麦块
      mod-names.js           常见模组中文名词库（人工校对）
      providers/             下载中心数据源
        types.js             资源类型 → 目标目录
        installer.js         安装器（递归依赖、进度回调、跳过重复）
        modrinth.js          Modrinth 搜索/版本/推荐
        curseforge.js        CurseForge 搜索/版本（分页）
        index.js             数据源聚合入口
  preload.js                 安全桥接（contextBridge 暴露 window.fedby）
  renderer/                  渲染层（原生 ES Module）
    index.html               界面骨架
    main.js                  页面注册、全局事件、启动引导
    shell.js                 标题栏 / 导航 / 账户 chip
    router.js                极简路由
    store.js                 全局状态与数据加载
    lib/                     dom / ipc / icons / theme / ui 工具
    components/              accounts 账户组件、versionCheck 版本检查弹窗
    pages/                   launch / versions / download / settings
    styles/                  base.css / layout.css / pages.css
build/
  icon.png                   应用图标（打包时自动转 7 个尺寸的 ICO）
tools/
  make-icon.js               绘制默认图标（纯 Node 生成 PNG）
  convert-icon.js            任意图片 → 方形 PNG（用 Electron nativeImage）
dist/                        打包产物（npm run dist 生成）
```

旧版单文件实现（`src/main.js`、`src/modules/`、`src/ui/`）已全部重写并删除，完整备份见 `src-legacy-backup.zip`。

## 验证状态

v1.0.0 的验证记录：

- 语法自检：主进程全部文件 `node --check` 通过；渲染层 15 个 ES Module 经 `vm.SourceTextModule` 编译通过
- 冒烟测试（`test-smoke.js`）：四页全部正常渲染（启动页 hero + 右侧三卡、版本页列表、下载页 4 卡片、设置页 8 卡片），首屏自动选中 `26.3`、`自动 · Java 25 (OpenLogic)`，**零控制台错误**
- 交互流程（`test-flow.js`）：推荐区 12 张卡（首项 Sodium）；搜索 24 卡片「找到 3.6K 个项目」；中文名 `Xaero 的小地图 / 机械动力 / 机械动力：蒸汽轨道`；安装弹窗默认匹配 26.3、15 个文件、44 个版本选项；版本检查 5 标签 / 8 项信息 / 7 个快捷目录；存档标签空状态正常，**零控制台错误**
- 端到端启动（`test-launch2.js`）：离线账户 → 26.3 → 真实进入主菜单（68 行日志，出现 `Backend library` / `OpenAL initialized`，末行仅剩离线账户预期的 Realms 认证失败），启动器状态显示「游戏运行中」，停止与账户清理正常，**零控制台错误**
- 服务层自检（`test-services.js`，无界面）17 项全部通过：版本详情 114 个库 / classpath 74 项零缺失 / 客户端 jar 存在；Java 扫描 4 个；`runtime.recommend` → 需要 Java 25、使用 Java 25 (OpenLogic)、分配 4096 MB；命令构建 36 个参数、无残留 `${}`、含 `-cp` 与主类、含 `-Xmx4096M` 与账户名且未真正启动；Modrinth 搜索 39 项、CurseForge 40 项、Sodium 版本列表 9 个；中文名 `机械动力 / JEI 物品管理器`；配置 patch 与数值收敛（9999 → 32）正常
- 打包产物（`test-packaged.js`）：`win-unpacked/FedbyLauncher.exe` 与 `FedbyLauncher-Portable-1.0.0.exe` 均实测启动 —— 页面以 `fedby://app/index.html` 加载（asar 内文件读取正常）、`app:info` 返回 1.0.0 / Electron 38.8.6、版本列表读到 26.3、四页渲染正常（4 / 1 / 4 / 8 卡片），**零控制台错误**；ICO 含 16/24/32/48/64/128/256 七个尺寸且为指定像素图
- 备份与迁移：`%APPDATA%\NebulaLauncher` 首次启动自动迁移为 `FedbyLauncher`，26.3 版本与账户保留 — 通过

## 测试脚本

| 脚本 | 用途 |
|---|---|
| `test-services.js` | 无界面跑服务层：版本/classpath/Java/命令构建/双源搜索/中文数据/配置 |
| `test-smoke.js` | 启动 Electron（CDP）：四页渲染、首屏自动选择、截图、控制台错误 |
| `test-flow.js` | 下载页推荐与搜索、安装弹窗筛选、版本检查五个标签 |
| `test-mslogin.js` | 微软登录弹窗、真实授权页加载、回调拦截与错误提示 |
| `test-launch2.js` | 离线账户真实启动 26.3 至主菜单，随后停止并清理测试账户 |
| `test-packaged.js` | 运行 `dist/` 里的打包产物（可用 `EXE=` 指定便携版），验证 asar 与协议 |

均为 `node test-xxx.js` 直接运行（脚本内部已清除 `ELECTRON_RUN_AS_NODE`）。

早期（重写前）的功能验证同样成立，记录如下：

- 引擎自检：版本识别、Java 扫描（检测到 6 个 Java）、74 项 classpath 零缺失、命令构建无残留占位符 — 通过
- 端到端启动：真实启动 26.3 并进入主菜单（窗口创建 + 音效引擎启动）— 通过
- Electron GUI：主进程与渲染进程正常启动、无错误日志 — 通过
- 下载中心：Modrinth 搜索（26.3 / Fabric 命中 38 个项目）、版本解析、真实下载安装 1.9MB 的 Sodium 26.3、已安装识别、重复安装跳过 — 通过
- 下载中心 GUI：界面渲染 24 张结果卡片、零 JS 异常、界面 IPC 真实安装并收到 122 次进度事件 — 通过
- IPC 参数传递：配置读写与其他带参接口在修复后均正常 — 通过
- 双源下载中心：中文翻译、CurseForge 搜索/版本/真实安装 JEI 26.3、Modrinth 兼容 — 通过
- GUI 双源搜索：Modrinth / CurseForge 中文数据正确、零 JS 异常 — 通过
- 界面改版（顶部分页放大居中、动效、主页完整账户区、主题色、资源中文名）— GUI 验证通过，零 JS 异常
- 社区中文源：Create → 机械动力、JEI → JEI 物品管理器、AppleSkin → 苹果皮、Xaero's Minimap → Xaero 的小地图；Sodium / Lithium 等无公认中文名的保留英文；描述取自百科中文简介 — GUI 验证通过，零 JS 异常
- 改名 Fedby 启动器：标题栏 / 窗口标题 / 提示文案全部更新；旧 `%APPDATA%\NebulaLauncher` 首次启动自动迁移为 `FedbyLauncher`，26.3 版本与账户保留 — 通过
- 自动配置：26.3 自动选中 Java 25 (OpenLogic)，自动内存 4096 MB（物理内存 15547 MB）— 通过
- 皮肤站：LittleSkin Yggdrasil 元信息读取成功；登录/同步链路已实现（需真实账号验证）
- 全版本下载：Modrinth `sodium` 全版本搜索 113 项，推荐区 10 个模组正常渲染，安装目标类型修正为模组 — 通过
- 版本文件夹入口与安装版本筛选：检查弹窗光影/存档标签均显示「打开文件夹」，基本信息页 7 个快捷目录；Sodium 安装弹窗默认匹配 26.3、匹配 18 个文件、切全版本 276 个（显示前 80）；自定义版本应用/取消正常，零 JS 异常 — 通过
- 微软登录（test-mslogin.js）：弹窗双微软徽标渲染正常；点击后真实打开 `login.live.com/oauth20_authorize.srf`，页面标题「登录」并显示「继续使用 Minecraft。电子邮件或电话号码」表单；关闭登录窗口回落为「已取消微软登录」且按钮可重开；伪造 `oauth20_desktop.srf?code=…` 回调可被拦截、窗口自动关闭、授权码进入换令牌链路（假码正确提示「授权码无效或已过期」），零 JS 异常 — 通过
