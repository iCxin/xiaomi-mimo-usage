/* ============================================================
   MiMo Token 用量看板 — language pack
   MiMo Token Usage Dashboard — language pack

   Flat key/value tables. `zh` is the reference: every key must exist
   there, and `en` is expected to mirror it. Values may contain HTML
   for the few places that need inline markup — they are authored here,
   never taken from user data.
   ============================================================ */

window.MIMO_I18N = {

  zh: {
    "lang.other": "EN",
    "lang.self": "中文",

    "app.title": "使用统计",
    "app.badge": "应用用量",

    /* --- stat row --- */
    "stat.cumulative": "累计 Token 数",
    "stat.peak": "峰值 Token 数",
    "stat.longestChat": "最长聊天时长",
    "stat.currentStreak": "当前连续天数",
    "stat.longestStreak": "最长连续天数",
    "stat.cumulativeTitle": "{n} tokens",
    "stat.peakTitle": "峰值出现在 {day}",
    "stat.longestChatTitle": "会话：{title}",

    /* --- units --- */
    "unit.day": "天",
    "unit.dayPlural": "天",
    "unit.hour": "小时",
    "unit.hourPlural": "小时",
    "unit.minute": "分钟",
    "unit.minutePlural": "分钟",
    "unit.second": "秒",
    "unit.secondPlural": "秒",
    "unit.times": "次",

    /* --- activity heatmap --- */
    "heat.title": "Token 活动",
    "heat.daily": "每日",
    "heat.weekly": "每周",
    "heat.cumulative": "累计",
    "heat.less": "少",
    "heat.more": "多",
    "heat.tipMessages": "{n} 轮消息",
    "heat.tipCumulative": "累计 {v}",
    "heat.tipThatDay": "当日 {v}",
    "heat.svgTitle": "Token 活动日历（周一为一周起始）",

    /* --- trend chart --- */
    "trend.title": "Token 趋势图",
    "trend.range7": "近 7 日",
    "trend.range30": "近 30 日",
    "trend.rangeAll": "全部",
    "trend.singleDay": "仅 1 天有数据",
    "trend.rangeNote": "{from} - {to}",
    "trend.noUsage": "当日无用量",
    "trend.empty": "所选时间范围内没有用量记录",
    "trend.svgTitle": "Token 趋势图，按模型分序列",

    /* --- donut --- */
    "donut.title": "模型用量",
    "donut.svgTitle": "模型用量占比",
    "donut.tokens": "tokens",

    /* --- composition bar --- */
    "comp.title": "Token 构成",
    "comp.totalNote": "{n} tokens 全部流量",
    "comp.empty": "无数据",

    /* --- part labels --- */
    "part.input": "输入",
    "part.output": "输出",
    "part.reasoning": "推理",
    "part.cacheRead": "缓存读取",
    "part.cacheWrite": "缓存写入",

    /* --- tables --- */
    "table.byModel": "按模型",
    "table.byModelNote": "已合并同名模型",
    "table.bySession": "按会话",
    "table.bySessionNote": "计费量为输入 + 输出 + 缓存写入",
    "th.model": "模型",
    "th.session": "会话",
    "th.billed": "计费量",
    "th.inOut": "输入+输出",
    "th.input": "输入",
    "th.output": "输出",
    "th.reasoning": "推理",
    "th.cacheRead": "缓存读取",
    "th.cacheHit": "缓存命中",
    "th.requests": "请求",
    "cell.allTokens": "全部 {n} tokens",
    "cell.providers": "供应商 {list}",
    "cell.archived": "已归档",
    "cell.deleted": "对话已删除 · 用量已保留",
    "cell.duration": "时长 {v}",
    "cell.noSession": "（已删除的会话）",

    /* --- tooltips --- */
    "tip.tokens": "{v} tokens",
    "tip.billed": "计费量",
    "tip.input": "输入",
    "tip.output": "输出",
    "tip.reasoning": "推理",
    "tip.cacheRead": "缓存读取",
    "tip.cacheWrite": "缓存写入",
    "tip.cacheHit": "缓存命中",
    "tip.totalTraffic": "全部流量",
    "tip.requests": "请求",
    "tip.requestsValue": "{n} 次",
    "tip.duration": "时长",
    "tip.created": "创建",

    /* --- notes dialog --- */
    "notes.open": "口径说明",
    "notes.title": "口径说明",
    "notes.close": "关闭",
    "notes.body": [
      "<b>模型已合并。</b>统计按模型 ID 归并，忽略 <code>jiyuanc</code> 这类供应商前缀——同一个模型经由不同供应商调用，合并为一条记录。表格里会列出实际用到的供应商。",
      "<b>累计 / 峰值 / 环形图</b>统计的是<b>全部 Token</b>（输入 + 输出 + 推理 + 缓存读写）。下方表格的<b>计费量</b>则是输入 + 输出 + 缓存写入，把缓存读取单列——缓存读取通常按大幅折扣计价，混入总量会掩盖真实成本结构。两者口径不同，数值不应直接比较。",
      "<b>峰值 Token 数</b>取单日最大消耗。若全部用量集中在同一天，累计与峰值会相等。",
      "<b>连续天数</b>按有消耗的自然日计算；当前连续天数为 0 表示今天还没有产生用量。",
      "<b>最长聊天时长</b>取单个会话内首条与末条消息的时间跨度，不是模型的生成耗时。",
      "<b>为什么删了对话统计还准。</b>引擎的 message 表对 session 是 <code>ON DELETE CASCADE</code>——删掉一个对话，它的消息行会一起被删。所以本看板在后台把用量累积到本地一份记录里，删掉的对话其用量仍然计入，表格里会标「对话已删除 · 用量已保留」。<span class=\"warn\">但首次运行之前就已删除的对话无法追回</span>，完整覆盖从页脚标注的时间点开始。",
      "<span class=\"warn\">本页不显示金额。</span>数据库里的 <code>cost</code> 字段由桌面端写入，实测恒为 <code>0</code>，无法据此换算费用。要查实际账单请前往 MiMo 账户用量页面。",
      "<b>自动更新：</b>保持监听脚本在后台运行，本页每 20 秒自动拉取一次最新数据，无需手动刷新。"
    ],

    /* --- footer --- */
    "foot.source": "数据源 {src}",
    "foot.requests": "{n} 次请求",
    "foot.sessions": "{n} 个会话",
    "foot.models": "{n} 个模型",
    "foot.snapshot": "导出快照 {at}",
    "foot.coverage": "统计完整覆盖自 {at} 起",
    "foot.coverageDeleted": "统计完整覆盖自 {at} 起 · 已保留 {n} 个已删除对话的用量",
    "refresh.label": "刷新",
    "auto.checking": "自动更新 · 每 {n} 秒检查",
    "auto.updated": "自动更新 · 已更新 {at}",
    "toast.refreshed": "已刷新 · {n} 次请求",
    "toast.failed": "无法读取 data.js：请先运行监听脚本，再按 Ctrl+R 重新载入页面",

    /* --- boot / empty states --- */
    "boot.noData": "未找到数据。请先运行 <code>export_tokens.py</code> 生成 data.js。",
    "boot.title": "使用统计 · MiMo Token 用量"
  },

  en: {
    "lang.other": "中文",
    "lang.self": "EN",

    "app.title": "Usage",
    "app.badge": "App usage",

    /* --- stat row --- */
    "stat.cumulative": "Total tokens",
    "stat.peak": "Peak tokens",
    "stat.longestChat": "Longest chat",
    "stat.currentStreak": "Current streak",
    "stat.longestStreak": "Longest streak",
    "stat.cumulativeTitle": "{n} tokens",
    "stat.peakTitle": "Peak on {day}",
    "stat.longestChatTitle": "Session: {title}",

    /* --- units --- */
    "unit.day": "day",
    "unit.dayPlural": "days",
    "unit.hour": "hr",
    "unit.hourPlural": "hrs",
    "unit.minute": "min",
    "unit.minutePlural": "min",
    "unit.second": "sec",
    "unit.secondPlural": "sec",
    "unit.times": "",

    /* --- activity heatmap --- */
    "heat.title": "Token activity",
    "heat.daily": "Daily",
    "heat.weekly": "Weekly",
    "heat.cumulative": "Cumulative",
    "heat.less": "Less",
    "heat.more": "More",
    "heat.tipMessages": "{n} messages",
    "heat.tipCumulative": "Cumulative {v}",
    "heat.tipThatDay": "That day {v}",
    "heat.svgTitle": "Token activity calendar (weeks start Monday)",

    /* --- trend chart --- */
    "trend.title": "Token trend",
    "trend.range7": "Last 7 days",
    "trend.range30": "Last 30 days",
    "trend.rangeAll": "All",
    "trend.singleDay": "only one day of data",
    "trend.rangeNote": "{from} - {to}",
    "trend.noUsage": "No usage that day",
    "trend.empty": "No usage in the selected range",
    "trend.svgTitle": "Token trend, one series per model",

    /* --- donut --- */
    "donut.title": "Model usage",
    "donut.svgTitle": "Share of tokens by model",
    "donut.tokens": "tokens",

    /* --- composition bar --- */
    "comp.title": "Token breakdown",
    "comp.totalNote": "{n} tokens total traffic",
    "comp.empty": "No data",

    /* --- part labels --- */
    "part.input": "Input",
    "part.output": "Output",
    "part.reasoning": "Reasoning",
    "part.cacheRead": "Cache read",
    "part.cacheWrite": "Cache write",

    /* --- tables --- */
    "table.byModel": "By model",
    "table.byModelNote": "same model merged across providers",
    "table.bySession": "By session",
    "table.bySessionNote": "billed = input + output + cache write",
    "th.model": "Model",
    "th.session": "Session",
    "th.billed": "Billed",
    "th.inOut": "In+Out",
    "th.input": "Input",
    "th.output": "Output",
    "th.reasoning": "Reasoning",
    "th.cacheRead": "Cache read",
    "th.cacheHit": "Cache hit",
    "th.requests": "Requests",
    "cell.allTokens": "{n} tokens total",
    "cell.providers": "provider {list}",
    "cell.archived": "archived",
    "cell.deleted": "conversation deleted · usage retained",
    "cell.duration": "{v} long",
    "cell.noSession": "(deleted session)",

    /* --- tooltips --- */
    "tip.tokens": "{v} tokens",
    "tip.billed": "Billed",
    "tip.input": "Input",
    "tip.output": "Output",
    "tip.reasoning": "Reasoning",
    "tip.cacheRead": "Cache read",
    "tip.cacheWrite": "Cache write",
    "tip.cacheHit": "Cache hit",
    "tip.totalTraffic": "Total traffic",
    "tip.requests": "Requests",
    "tip.requestsValue": "{n}",
    "tip.duration": "Duration",
    "tip.created": "Created",

    /* --- notes dialog --- */
    "notes.open": "Methodology",
    "notes.title": "How these numbers are computed",
    "notes.close": "Close",
    "notes.body": [
      "<b>Models are merged.</b> Everything is grouped by model ID, ignoring provider prefixes like <code>jiyuanc</code> — the same model reached through two providers is one model, not two. The providers actually seen are listed in the table.",
      "<b>Total / peak / the donut</b> count <b>all tokens</b> (input + output + reasoning + cache read/write). The <b>billed</b> column in the tables below is input + output + cache write, with cache reads broken out separately — cache reads are usually heavily discounted, and folding them in would hide the real cost structure. The two are different measures and should not be compared directly.",
      "<b>Peak tokens</b> is the largest single-day total. If all usage falls on one day, the total and the peak will be equal.",
      "<b>Streaks</b> count consecutive calendar days with usage. A current streak of 0 means nothing has been spent today yet.",
      "<b>Longest chat</b> is the time between the first and last message in a single session, not how long the model spent generating.",
      "<b>Why totals survive deleting a conversation.</b> The engine's <code>message</code> table cascades deletes from <code>session</code>, so removing a conversation also removes its message rows. This dashboard therefore accumulates usage into a local record as it goes: a deleted conversation keeps contributing and is marked \"conversation deleted · usage retained\" in the table. <span class=\"warn\">Conversations deleted before the first run cannot be recovered</span> — full coverage starts at the timestamp in the footer.",
      "<span class=\"warn\">This page shows no money.</span> The <code>cost</code> field in the database is written by the desktop app and is always <code>0</code> in practice, so no spend figure can be derived from it. For actual billing, see your MiMo account usage page.",
      "<b>Auto-refresh:</b> keep the watcher script running in the background and this page re-reads the data every 20 seconds. No manual refresh needed."
    ],

    /* --- footer --- */
    "foot.source": "Source {src}",
    "foot.requests": "{n} requests",
    "foot.sessions": "{n} sessions",
    "foot.models": "{n} models",
    "foot.snapshot": "snapshot {at}",
    "foot.coverage": "full coverage from {at}",
    "foot.coverageDeleted": "full coverage from {at} · {n} deleted conversation(s) retained",
    "refresh.label": "Refresh",
    "auto.checking": "Auto-refresh · checking every {n}s",
    "auto.updated": "Auto-refresh · updated {at}",
    "toast.refreshed": "Refreshed · {n} requests",
    "toast.failed": "Could not read data.js — start the watcher, then reload the page with Ctrl+R",

    /* --- boot / empty states --- */
    "boot.noData": "No data found. Run <code>export_tokens.py</code> to generate data.js first.",
    "boot.title": "Usage · MiMo Token Usage"
  }
};
