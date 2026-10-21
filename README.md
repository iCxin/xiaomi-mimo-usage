<div align="right"><sub><code>iCxin / xiaomi-mimo-usage</code></sub></div>

# MiMo Token Usage

> 读 MiMo Desktop 自己的 SQLite 数据库，把用量画成一个完全离线的本地看板。
> Local dashboard for MiMo Desktop token usage — reads the engine's SQLite database, no network at runtime.

| | |
|:--|:--|
| **状态** | 活跃维护 |
| **栈** | `Python` · `HTML` / `CSS` / `JavaScript`（无构建） |
| **平台** | Windows / macOS / Linux |
| **许可** | MIT |

---

## 01 · 这是什么

MiMo Desktop 不保存花过多少 token 的历史，输入框旁边只有一个上下文环。数字其实在本机——引擎的 SQLite 数据库里。这个项目读那个库，把它渲染成看板，全程离线，页面不发任何网络请求，数据不离开本机。

## 02 · 特性

- **概览行**：总 token、峰值日、最长对话、当前与最长连续天数。
- **活动日历**：一年用量的热力图，可按日、按周、按累计切换。
- **趋势图**：每个模型一条曲线，覆盖最近 7 天 / 30 天或全部时间。
- **模型构成与明细**：环形图加表格，同名模型跨提供商合并；另有按会话、按模型两张明细表，悬停可看每一行的完整数字。
- **自动刷新**：watcher 运行后页面每 20 秒重读一次数据。
- **双语**：中文与英文，按浏览器语言选择，可在页头切换。

## 03 · 开始使用

要求：MiMo Desktop 至少运行过一次（这样才有数据库）；Python 3.8+ 且带 `sqlite3` 模块（标准库自带）。没有自己的 Python 时，启动脚本会去找 MiMo Desktop 捆绑的运行时。不需要 `pip install` 任何东西。

Windows 双击 `start.cmd`；macOS / Linux：

```sh
./start.sh
```

两者都会刷新数据、启动后台 watcher 并在浏览器打开看板。停止用 `stop.cmd` / `./stop.sh`。不想留后台进程时，跑 `python3 export_tokens.py` 生成一次 `data.js`，再自己打开 `index.html`，之后用页面上的 Refresh 按钮刷新。

## 04 · 数字怎么算

页面上有两个 token 总数，它们不可比：

| 口径 | 统计内容 | 出现位置 |
|---|---|---|
| **All tokens** | input + output + reasoning + cache read + cache write | 概览行、环形图、趋势图 |
| **Billed** | input + output + cache write | 两张表的 `Billed` 列 |

Cache read 单独拆出：它通常按大幅折扣计费，往往占总流量的 90% 以上，折进主数字会掩盖真实成本结构。页脚的 Methodology 按钮在界面里重复以下口径。

- **不显示金额**。数据库有 `cost` 字段，但 MiMo Desktop 永远写 `0`，由此得出的花费都是假的；真实账单看 MiMo 账户的用量页。
- **同 ID 的模型合并**。同一个模型经由两个提供商（例如 `jiyuanc/deepseek-flash` 与 `jiyuan/deepseek-flash`）算一个模型，表格里列出实际见到的提供商。
- **删对话不丢用量**。引擎的 `message` 表随 `session` 级联删除，删掉一次对话会带走它的 token 历史，总量因此会往下漂。看板一边读一边把用量折进本地累积库 `usage_history.db`，被删的对话继续计入，并在表格里标为 conversation deleted · usage retained。首次运行之前就被删的对话无法追回，页脚会注明完整覆盖从哪天开始；删掉 `usage_history.db` 即可重来，它会按数据库现存内容重建。
- **连续天数**按有使用的连续自然日计，当前连续为 `0` 表示今天还没用过；**最长对话**是会话首尾两条消息的时间跨度，不是模型生成耗时。

## 05 · 接入 MiMo Desktop

MiMo Desktop 是签名闭源的，无法给它加原生面板。两个扩展点可以接近这个效果。

**skill：在对话里打开看板。** 把 `skill/` 拷进 MiMoCode 的 skills 目录：

```powershell
Copy-Item -Recurse skill "$env:USERPROFILE\.config\mimocode\skills\mimo-usage"
```

macOS / Linux 用 `cp -r skill ~/.config/mimocode/skills/mimo-usage`。之后让 MiMo 显示用量，或执行 `/mimo-usage`，看板会在对话旁的预览面板里打开。

**MCP server：让 MiMo 直接回答用量问题。** `mcp_server.py` 是无依赖的 MCP server（stdio JSON-RPC，不需要 SDK），读同一个数据库，暴露四个工具：`usage_summary`（总量、最忙的一天、连续天数、最长对话）、`usage_by_model`（按模型拆分，跨提供商合并）、`usage_by_session`（哪几次对话用得最多）、`usage_timeline`（每日总量）。

注册会改 MiMoCode 配置并留下带时间戳的备份：

```sh
python3 register_mcp.py --config ~/.config/mimocode/mimocode.jsonc --server mcp_server.py --python "$(command -v python3)"
```

Windows 的配置在 `%USERPROFILE%\.config\mimocode\mimocode.jsonc`。重启引擎或新开一次对话，然后问「这周我用掉多少 token」。撤销用 `python3 register_mcp.py --config <path> --remove`；接线前可先跑 `python3 mcp_server.py --selftest` 单独验证。

## 06 · 配置

数据库自动探测，顺序为：`$MIMO_DB` → `$XDG_DATA_HOME/mimocode/mimocode.db`（或 `~/.local/share/mimocode/mimocode.db`）→ `~/Library/Application Support/mimocode/mimocode.db`（macOS）→ `%APPDATA%\Xiaomi MiMo\mimocode\mimocode.db` 及类似路径（Windows）。用下面两条命令查看它探测到哪个库，或指定别的路径：

```sh
python3 export_tokens.py --print-db
python3 export_tokens.py --db /path/to/mimocode.db
```

watcher 接受同样的路径参数，另有：

| 参数 | 作用 |
| --- | --- |
| `--interval` | 轮询间隔（秒） |
| `--min-gap` | 两次导出之间的最小间隔（秒） |
| `--status` | 是否有 watcher 在跑 |
| `--stop` | 停止 watcher |

## 07 · 文件

`index.html` 是看板入口，`app.js` 负责渲染，`i18n.js` 存中英文文案，`styles.css` 管样式，`data.js` 是生成的用量快照（已 gitignore）；`export_tokens.py` 读库写快照，`usage_store.py` 是持久累积库，`watch_tokens.py` 保持快照最新，`mcp_server.py` 与 `register_mcp.py` 负责 MCP 接入，`start.*` / `stop.*` / `find-python.*` 是启动与 Python 发现脚本，`make_demo_data.py` 生成虚构快照供截图与测试。想做界面预览又不动真实数据，跑 `python3 make_demo_data.py`，看完再跑一次 `export_tokens.py` 恢复。

## 08 · 常见问题

| 现象 | 处理 |
| --- | --- |
| `Python 3 was not found.` | 装上 Python 3，或用 `MIMO_PYTHON` 指定解释器 |
| `Could not find mimocode.db.` | 先运行一次 MiMo Desktop；数据在别处就用 `--db PATH` 或 `MIMO_DB` |
| 页面没有数据 / 数字是旧的 | `data.js` 还没生成或还是上次导出的快照：跑 `python3 export_tokens.py`，保持 watcher 运行，再按 Refresh |
| Refresh 说读不到 data.js | `file://` 页面禁止 `fetch`，回退也可能被缓存挡住，用 Ctrl+R / Cmd+R 重载 |
| 布局变成单列 | 两列要窗口宽 1200px，窄屏下单列更宽敞 |

## 09 · 兼容与隐私

在 Windows 上针对 MiMo Desktop `26.922.222056` 构建与测试。数据库结构与消息载荷在多个版本间都变过，因此读取端把每个字段都当可选：未知字段忽略，解析失败的行跳过并在控制台计数，缺表给出明确错误而不是 traceback。看板本身是纯 HTML/CSS/JS，无构建步骤、无依赖，当前版本的 Chromium、Firefox、Safari 都能跑。

数据库通过临时副本读取，运行中的 MiMo Desktop 不会遇到锁或写入。`data.js` 含会话标题与工作目录，因此已 gitignore——分享前先检查。代码以 [MIT](LICENSE) 许可发布。

---

<div align="right"><sub>从像素到混凝土 · <a href="https://github.com/iCxin">iCxin</a></sub></div>
