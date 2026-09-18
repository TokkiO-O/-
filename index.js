	/**
	 * 美化管理 Theme Manager v0.5.1
	 *
	 * 0.5.1 修复（针对 "加载失败 [object Event] / Failed to fetch dynamically imported module"）：
	 *   1. 酒馆核心模块改为运行时多路径探测导入，自动兼容
	 *      /scripts/extensions/<名>/ 与 /scripts/extensions/third-party/<名>/ 两种挂载深度
	 *   2. scripts/save-settings.js 在老版本酒馆不存在时，自动回退到 script.js 的导出
	 *   3. lib/ 四个文件全部并入本文件 —— 仓库只需要 3 个文件
	 *   4. CodeMirror CDN 增加 fastly / npmmirror 备用源；全部失败降级纯文本编辑
	 */
	(async () => {
	    /* ================================================================
	     * 0) 定位酒馆核心模块（多路径探测，兼容不同版本/客户端的挂载深度）
	     * ================================================================ */
	    const PREFIXES = ["../../../../", "../../../", "/", "../../../../../../"];
	    async function probe(file, { optional = false } = {}) {
	        const tried = [];
	        for (const p of PREFIXES) {
	            try {
	                const mod = await import(p + file);
	                console.info(`[美化管理] ${file} ← ${p}${file} 加载成功`);
	                return mod;
	            }
	            catch (e) {
	                tried.push(`${p}${file}：${e?.message ?? e}`);
	            }
	        }
	        if (!optional) console.error(`[美化管理] ${file} 所有候选路径均失败：\n` + tried.join("\n"));
	        throw new Error(file);
	    }
	    let extension_settings, eventSource, event_types, saveSettingsDebounced;
	    try {
	        ({ extension_settings } = await probe("scripts/extensions.js"));
	        const scriptMod = await probe("script.js");
	        eventSource = scriptMod.eventSource;
	        event_types = scriptMod.event_types;
	        try {
	            saveSettingsDebounced = (await probe("scripts/save-settings.js", { optional: true })).saveSettingsDebounced;
	        }
	        catch {
	            saveSettingsDebounced = scriptMod.saveSettingsDebounced; // 老版本从 script.js 导出
	        }
	    }
	    catch (e) {
	        window.toastr?.error?.(`美化管理：酒馆核心模块加载失败（${e.message}）。请按 F12 打开控制台，把 [美化管理] 开头的红色报错截图发给开发者`);
	        return;
	    }
	    if (!extension_settings || !eventSource) {
	        window.toastr?.error?.("美化管理：核心模块缺少必要导出（extension_settings / eventSource），扩展未启动");
	        return;
	    }
	    if (typeof saveSettingsDebounced !== "function") {
	        saveSettingsDebounced = () => console.warn("[美化管理] saveSettingsDebounced 不可用，改动可能不会立即写入磁盘");
	    }
	    /* ================================================================
	     * 工程骨架：数据持久化 + 样式注入层（不碰 power_user.custom_css）
	     * ================================================================ */
	    const EXT = "st_theme_manager";
	    const S = () => extension_settings[EXT];
	    const clone = o => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
	    const DEFAULTS = {
	        enabled: true,
	        themes: {}, activeIds: [], toggles: {}, mobileFix: {},
	        viewMode: "grid", favorites: [], lastUsedAt: {}, useCount: {},
	        sortBy: "updated", search: "", tagFilter: "", favOnly: false,
	    };
	    function loadSettings() {
	        if (!extension_settings[EXT]) extension_settings[EXT] = clone(DEFAULTS);
	        for (const k of Object.keys(DEFAULTS)) if (S()[k] === undefined) S()[k] = clone(DEFAULTS[k]);
	    }
	    function applyTheme(theme) {
	        const css = [
	            buildActiveCss(theme, S().toggles[theme.id]),
	            S().mobileFix[theme.id]?.enabled ? S().mobileFix[theme.id].css : "",
	        ].filter(Boolean).join("\n");
	        let el = document.head.querySelector(`style[data-theme-id="${CSS.escape(theme.id)}"]`);
	        if (!el) { el = document.createElement("style"); el.setAttribute("data-theme-id", theme.id); document.head.appendChild(el); }
	        el.textContent = css;
	    }
	    function refreshAll() {
	        document.head.querySelectorAll("style[data-theme-id]").forEach(el => {
	            if (!S().activeIds.includes(el.getAttribute("data-theme-id"))) el.remove();
	        });
	        S().activeIds = S().activeIds.filter(id => S().themes[id]);
	        for (const id of S().activeIds) applyTheme(S().themes[id]);
	    }
	    function enableTheme(id) {
	        if (S().themes[id] && !S().activeIds.includes(id)) S().activeIds.push(id);
	        S().lastUsedAt[id] = Date.now();
	        S().useCount[id] = (S().useCount[id] || 0) + 1;
	        saveSettingsDebounced(); refreshAll();
	    }
	    function disableTheme(id) { S().activeIds = S().activeIds.filter(x => x !== id); saveSettingsDebounced(); refreshAll(); }
	    function setBlockToggle(themeId, block, on) { (S().toggles[themeId] ||= {})[block] = on; saveSettingsDebounced(); refreshAll(); }
	    /* ================================================================
	     * M4 组件模块化：CSS 拆块 / 块级开关（原 lib/core.js）
	     * ================================================================ */
	    function parseBlocks(css) {
	        const marks = [...String(css).matchAll(/\/\*\s*@theme-block:\s*([\w-]+)\s*\*\//g)];
	        if (!marks.length) return { other: css.trim() };
	        const blocks = {};
	        if (marks[0].index > 0) blocks.other = css.slice(0, marks[0].index).trim();
	        marks.forEach((m, i) => {
	            const start = m.index + m[0].length;
	            const end = i + 1 < marks.length ? marks[i + 1].index : css.length;
	            blocks[m[1]] = css.slice(start, end).trim();
	        });
	        return blocks;
	    }
	    function buildActiveCss(theme, toggles) {
	        const t = toggles || {};
	        return Object.entries(theme.blocks)
	            .filter(([name]) => t[name] !== false)
	            .map(([name, css]) => `/* block: ${name} */\n${css}`)
	            .join("\n\n");
	    }
	    /* ================================================================
	     * M9 移动端静态分析（原 lib/core.js）
	     * ================================================================ */
	    const MOBILE_RULES = [
	        { re: /(?:^|[;\s])(?:width|height)\s*:\s*(\d{4,})px/g, lv: "❌", hint: m => `固定 ${m[1]}px 超出手机视口(390px)，建议 max-width/百分比` },
	        { re: /min-width\s*:\s*([5-9]\d{2,})px/g, lv: "❌", hint: m => `min-width:${m[1]}px 会撑破 390px 视口` },
	        { re: /padding\s*:\s*(\d{3,})px/g, lv: "⚠️", hint: m => `padding:${m[1]}px 过大，移动端建议 ≤32px` },
	        { re: /position\s*:\s*fixed/g, lv: "⚠️", hint: () => "position:fixed 易遮挡手机输入区，建议包进 @media (hover:hover)" },
	    ];
	    function auditMobile(css) {
	        const issues = [];
	        for (const r of MOBILE_RULES) {
	            r.re.lastIndex = 0;
	            let m;
	            while ((m = r.re.exec(css))) issues.push(`L${css.slice(0, m.index).split("\n").length} ${r.lv} ${r.hint(m)}`);
	        }
	        css.split("\n").forEach((l, i) => {
	            if (/:(hover)\b/.test(l) && !/@media/.test(l)) issues.push(`L${i + 1} ℹ️ :hover 在触屏无效，建议补 :active/:focus-visible`);
	        });
	        return issues.length ? issues : ["✅ 未发现明显移动端问题"];
	    }
	    function buildMobileFix() {
	        return [
	            "/* auto mobile-fix（独立层，可单独删除） */",
	            "@media (max-width: 425px) {",
	            "  #chat, .mes, .mes_block, .mes_text, #send_form, #form_sheld { min-width: 0 !important; max-width: 100% !important; }",
	            "  .mes { padding: 8px !important; }",
	            "}",
	        ].join("\n");
	    }
	    /* ================================================================
	     * M2 预览系统：仿真酒馆 DOM（原 lib/mock-dom.js）
	     * ================================================================ */
	    const CHAT = [
	        ["char", "欢迎光临旅店，旅人。第一杯蜂蜜酒算我请的。🍻", "Seraphina"],
	        ["user", "（推开门，抖了抖肩上的雪）路上遇到暴风雪了。"],
	        ["char", "哎呀，瞧你一身雪。快到壁炉边坐，我给你倒杯热的。", "Seraphina"],
	        ["user", "多谢。这里比传闻中还要热闹啊。"],
	        ["char", "哈哈，那边吟游诗人刚讲了个龙的笑话，整个旅店都笑了。想听吗？", "Seraphina"],
	        ["user", "当然，我最喜欢龙的笑话。"],
	        ["char", "龙走进旅店，所有人都跑光了——因为它根本挤不进门！😄", "Seraphina"],
	        ["user", "（喷出一口蜂蜜酒）哈哈哈这也太冷了！"],
	        ["char", "那接下来想听什么？冒险故事，还是……你自己的故事？", "Seraphina"],
	        ["user", "我的故事？不过是个满身风雪的旅人罢了。"],
	    ];
	    const AV = (ch, color) => "data:image/svg+xml," + encodeURIComponent(
	        `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${color}"/><text x="48" y="60" font-size="34" text-anchor="middle" fill="#fff" font-family="sans-serif">${ch}</text></svg>`);
	    const AV_CHAR = AV("S", "#5b6ee1");
	    const AV_USER = AV("你", "#3f78bc");
	    const BASE_CSS = `
	*{box-sizing:border-box} html,body{height:100%;margin:0}
	body{display:flex;flex-direction:column;font:15px/1.65 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;
	  background:var(--theme-bg,#181825);color:var(--text,#e6e6ef)}
	#top-bar{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:rgba(0,0,0,.28);font-size:16px}
	#site-logo{font-size:13px;opacity:.75;letter-spacing:.5px}
	#top-bar-icons span{margin-left:10px;cursor:pointer}
	#sheld{flex:1;display:flex;min-height:0}
	#chat{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin}
	.mes{position:relative}
	.mes_block::after{content:"";display:block;clear:both}
	.ch_name{display:flex;justify-content:space-between;align-items:center;font-weight:600;font-size:.92em;color:var(--accent,#9ab3ff)}
	.mes.is_user .name_text{color:#7bd88f}
	.mes_buttons{display:flex;gap:8px;opacity:.45;font-size:.9em}
	.swipe_left,.swipe_right{position:absolute;top:0;bottom:0;display:none;align-items:center;cursor:pointer;opacity:.35}
	.swipe_left{left:2px}.swipe_right{right:2px}
	.mesAvatarWrapper{float:left;width:56px;margin:2px 10px 4px 0}
	.avatar img{width:100%;display:block;border-radius:8px}
	.mes_text{padding:9px 12px;background:rgba(255,255,255,.05);border-radius:12px;white-space:pre-wrap;word-break:break-word;overflow:hidden}
	#form_sheld{border-top:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.22)}
	#form_sheld_form{display:flex;align-items:flex-end;gap:8px;padding:10px}
	#options_button{width:36px;height:36px;display:grid;place-items:center;cursor:pointer;border-radius:8px}
	#send_textarea{flex:1;min-height:36px;max-height:140px;overflow-y:auto;padding:8px 12px;border-radius:10px;
	  background:rgba(255,255,255,.06);outline:none;font:inherit;color:inherit}
	#send_textarea:empty::before{content:"在此输入消息…";opacity:.45}
	#rightSendForm{display:flex;gap:6px}
	#send_but{width:38px;height:38px;display:grid;place-items:center;border-radius:50%;cursor:pointer;background:var(--accent,#5b6ee1);color:#fff}
	#mes_stop{display:none}
	.tm-hint{text-align:center;font-size:11px;opacity:.4;padding:6px 0 2px}
	`;
	    function buildMockChatHTML({ msgCount = 3, themeCss = "" } = {}) {
	        const msgs = [];
	        for (let i = 0; i < msgCount; i++) {
	            const [who, text, name] = CHAT[i % CHAT.length];
	            const isUser = who === "user";
	            msgs.push(
	`<div class="mes ${isUser ? "is_user" : ""}${i === 0 ? " first_mes" : ""}${i === msgCount - 1 ? " last_mes" : ""}" mesid="${i}">
	<div class="swipe_left">‹</div><div class="swipe_right">›</div>
	<div class="mes_block">
	<div class="ch_name"><span class="name_text">${isUser ? "你" : name}</span>
	<div class="mes_buttons"><span class="mes_button mes_edit" title="编辑">✏️</span><span class="mes_button mes_copy" title="复制">⧉</span></div></div>
	<div class="mesAvatarWrapper"><div class="avatar"><img src="${isUser ? AV_USER : AV_CHAR}" alt=""></div></div>
	<div class="mes_text">${text}</div>
	</div>
	</div>`);
	        }
	        const safeCss = String(themeCss).replace(/<\/(style|script)/gi, "<\\/$1");
	        return `<!DOCTYPE html>
	<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
	<head>
	<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
	<style id="tm-mock-base">${BASE_CSS}</style>
	<style id="tm-preview-style">${safeCss}</style>
	</head>
	<body>
	<div id="top-bar">
	<div id="nav-toggle" title="菜单">☰</div>
	<div id="site-logo">SillyTavern · 模拟预览</div>
	<div id="top-bar-icons"><span title="Wand">🪄</span><span title="设置">⚙️</span></div>
	</div>
	<div id="sheld"><div id="chat">${msgs.join("")}
	<div class="tm-hint">— 模拟对话（${msgCount} 条）· 一切以真实应用为准 —</div>
	</div></div>
	<div id="form_sheld">
	<form id="form_sheld_form">
	<div id="nonQRFormItems">
	<div id="leftSendForm"><div id="options_button" title="选项">☰</div></div>
	<div id="send_textarea" contenteditable="true"></div>
	</div>
	<div id="rightSendForm">
	<div id="mes_stop" title="停止">■</div>
	<div id="send_but" title="发送">➤</div>
	</div>
	</form>
	</div>
	</body></html>`;
	    }
	    /* ================================================================
	     * M2 预览管理器（原 lib/preview.js）
	     * ================================================================ */
	    const DEVICES = {
	        mobile:    { w: 390,  h: 720, icon: "📱", label: "手机" },
	        landscape: { w: 844,  h: 390, icon: "↔️", label: "横屏" },
	        tablet:    { w: 768,  h: 900, icon: "📋", label: "平板" },
	        pc:        { w: 1920, h: 940, icon: "🖥", label: "PC" },
	    };
	    class PreviewManager {
	        constructor($root, { msgCount = 3, device = "mobile", onCapture = null } = {}) {
	            this.$root = $root; this.msgCount = msgCount; this.device = device; this.css = "";
	            this.onCapture = onCapture; this._built = false;
	            this._onWinResize = () => this.relayout();
	        }
	        mount() {
	            if (this._built) return; this._built = true;
	            this.$root.addClass("tm-preview").append(`
	<div class="tm-prev-bar">
	  <div class="tm-prev-devices">
	    ${Object.entries(DEVICES).map(([k, d]) =>
	        `<button class="menu_button tm-dev" data-dev="${k}" title="${d.w} × ${d.h}">${d.icon}${d.label}</button>`).join("")}
	  </div>
	  <div class="tm-prev-right">
	    <select class="tm-msg-count" title="聊天长度模拟">
	      <option value="3">3 条</option><option value="20">20 条</option>
	    </select>
	    <button class="menu_button tm-refresh" title="手动刷新预览">🔄</button>
	    <button class="menu_button tm-capture" title="生成预览图（入库展示 / 分享用）">📸</button>
	  </div>
	</div>
	<div class="tm-prev-stage"><div class="tm-prev-framebox"><iframe class="tm-prev-frame" sandbox="allow-same-origin"></iframe></div></div>`);
	            this.$frame = this.$root.find(".tm-prev-frame");
	            this.$box   = this.$root.find(".tm-prev-framebox");
	            this.$stage = this.$root.find(".tm-prev-stage");
	            this.$root.find(".tm-dev").on("click", e => this.setDevice($(e.currentTarget).data("dev")));
	            this.$root.find(".tm-msg-count").on("change", e => this.setMsgCount(Number(e.target.value)));
	            this.$root.find(".tm-refresh").on("click", () => this.rebuild());
	            this.$root.find(".tm-capture").on("click", () => this.onCapture?.());
	            $(window).on("resize", this._onWinResize);
	            this.setMsgCount(this.msgCount);
	            this.setDevice(this.device);
	        }
	        setDevice(key) {
	            if (!DEVICES[key]) return;
	            this.device = key;
	            this.$root.find(".tm-dev").removeClass("tm-on");
	            this.$root.find(`.tm-dev[data-dev="${key}"]`).addClass("tm-on");
	            this.relayout();
	        }
	        setMsgCount(n) { this.msgCount = n; this.$root.find(".tm-msg-count").val(String(n)); this.rebuild(); }
	        relayout() {
	            if (!this.$frame) return;
	            const d = DEVICES[this.device];
	            const avail = (this.$stage.width() || 360) - 20;
	            const s = Math.min(1, avail / d.w);
	            this.$frame.css({ width: d.w, height: d.h, transform: `scale(${s})` });
	            this.$box.css({ width: Math.floor(d.w * s), height: Math.floor(d.h * s) });
	        }
	        rebuild() {
	            if (!this.$frame) return;
	            const frame = this.$frame[0];
	            frame.onload = () => { this.setCss(this.css); this.relayout(); };
	            frame.srcdoc = buildMockChatHTML({ msgCount: this.msgCount, themeCss: this.css });
	        }
	        setCss(css) {
	            this.css = css;
	            const el = this.$frame?.[0]?.contentDocument?.getElementById?.("tm-preview-style");
	            if (el) el.textContent = css;
	        }
	        destroy() { $(window).off("resize", this._onWinResize); }
	        async capturePng(maxW = 640) {
	            const doc = this.$frame[0].contentDocument;
	            if (!doc?.body) throw new Error("预览尚未就绪，请先刷新再试");
	            const d = DEVICES[this.device];
	            const html = doc.documentElement.cloneNode(true);
	            html.querySelectorAll(".tm-hint").forEach(el => el.remove());
	            const xhtml = new XMLSerializer().serializeToString(html);
	            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d.w}" height="${d.h}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
	            const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
	            try {
	                const img = new Image();
	                await new Promise((ok, err) => {
	                    img.onload = ok;
	                    img.onerror = () => err(new Error("生成失败：快照不支持外链图片/字体"));
	                    img.src = url;
	                });
	                const s = Math.min(1, maxW / d.w);
	                const cv = document.createElement("canvas");
	                cv.width = Math.round(d.w * s); cv.height = Math.round(d.h * s);
	                cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
	                return cv.toDataURL("image/png");
	            } finally { URL.revokeObjectURL(url); }
	        }
	    }
	    /* ================================================================
	     * M3.1 代码模式编辑器（原 lib/editor.js，CodeMirror 5 + 多CDN）
	     * ================================================================ */
	    const CM_VER = "5.65.18";
	    const CM_BASES = [
	        `https://cdn.jsdelivr.net/npm/codemirror@${CM_VER}`,
	        `https://fastly.jsdelivr.net/npm/codemirror@${CM_VER}`,
	        `https://registry.npmmirror.com/codemirror/${CM_VER}/files`,
	    ];
	    let CM_BASE = null;
	    const loadedUrls = new Set();
	    function injectAsset(type, url) {
	        if (loadedUrls.has(url)) return Promise.resolve();
	        return new Promise((resolve, reject) => {
	            let el;
	            if (type === "js") { el = document.createElement("script"); el.src = url; }
	            else { el = document.createElement("link"); el.rel = "stylesheet"; el.href = url; }
	            el.onload = () => { loadedUrls.add(url); resolve(); };
	            el.onerror = () => { el.remove(); reject(new Error(`加载失败：${url}`)); };
	            document.head.appendChild(el);
	        });
	    }
	    async function loadOnce(type, path) {
	        if (CM_BASE === null) {                       // 用第一个文件探测可用 CDN
	            for (const base of CM_BASES) {
	                try { await injectAsset(type, `${base}/${path}`); CM_BASE = base; return; }
	                catch { /* 换下一个源 */ }
	            }
	            throw new Error("所有 CodeMirror CDN 均不可用");
	        }
	        await injectAsset(type, `${CM_BASE}/${path}`);
	    }
	    async function ensureCodeMirror() {
	        if (window.CodeMirror?.cssModeReady) return;
	        await loadOnce("css", "lib/codemirror.min.css");
	        await loadOnce("css", "theme/material-darker.min.css");
	        await loadOnce("css", "addon/fold/foldgutter.min.css");
	        await loadOnce("css", "addon/dialog/dialog.min.css");
	        await loadOnce("css", "addon/lint/lint.min.css");
	        await loadOnce("js", "lib/codemirror.min.js");
	        await Promise.all([
	            loadOnce("js", "mode/css/css.min.js"),
	            loadOnce("js", "addon/edit/closebrackets.min.js"),
	            loadOnce("js", "addon/edit/matchbrackets.min.js"),
	            loadOnce("js", "addon/selection/active-line.min.js"),
	            loadOnce("js", "addon/fold/foldcode.min.js"),
	            loadOnce("js", "addon/fold/foldgutter.min.js"),
	            loadOnce("js", "addon/fold/brace-fold.min.js"),
	            loadOnce("js", "addon/dialog/dialog.min.js"),
	            loadOnce("js", "addon/search/searchcursor.min.js"),
	            loadOnce("js", "addon/search/search.min.js"),
	            loadOnce("js", "addon/search/jump-to-line.min.js"),
	            loadOnce("js", "addon/lint/lint.min.js"),
	        ]);
	        window.CodeMirror.cssModeReady = true;
	    }
	    const KNOWN_PROPS = new Set(`
	align-content,align-items,align-self,all,animation,animation-delay,animation-direction,animation-duration,
	animation-fill-mode,animation-iteration-count,animation-name,animation-play-state,animation-timing-function,
	appearance,aspect-ratio,backdrop-filter,backface-visibility,background,background-attachment,background-blend-mode,
	background-clip,background-color,background-image,background-origin,background-position,background-position-x,
	background-position-y,background-repeat,background-size,block-overflow,border,border-bottom,border-bottom-color,
	border-bottom-left-radius,border-bottom-right-radius,border-bottom-style,border-bottom-width,border-collapse,
	border-color,border-image,border-image-outset,border-image-repeat,border-image-slice,border-image-source,
	border-image-width,border-left,border-left-color,border-left-style,border-left-width,border-radius,border-right,
	border-right-color,border-right-style,border-right-width,border-spacing,border-style,border-top,border-top-color,
	border-top-left-radius,border-top-right-radius,border-top-style,border-top-width,border-width,bottom,
	box-decoration-break,box-shadow,box-sizing,break-after,break-before,break-inside,caption-side,caret-color,clear,
	clip,clip-path,color,color-scheme,column-count,column-fill,column-gap,column-rule,column-rule-color,
	column-rule-style,column-rule-width,column-span,column-width,columns,contain,content,counter-increment,
	counter-reset,cursor,direction,display,empty-cells,filter,flex,flex-basis,flex-direction,flex-flow,flex-grow,
	flex-shrink,flex-wrap,float,font,font-family,font-feature-settings,font-size,font-size-adjust,font-stretch,
	font-style,font-synthesis,font-variant,font-variant-caps,font-variant-ligatures,font-variant-numeric,
	font-variation-settings,font-weight,gap,grid,grid-area,grid-auto-columns,grid-auto-flow,grid-auto-rows,
	grid-column,grid-column-end,grid-column-start,grid-row,grid-row-end,grid-row-start,grid-template,
	grid-template-areas,grid-template-columns,grid-template-rows,height,hyphens,image-rendering,inline-size,inset,
	inset-block,inset-block-end,inset-block-start,inset-inline,inset-inline-end,inset-inline-start,isolation,
	justify-content,justify-items,justify-self,left,letter-spacing,line-break,line-clamp,line-height,list-style,
	list-style-image,list-style-position,list-style-type,margin,margin-block,margin-block-end,margin-block-start,
	margin-bottom,margin-inline,margin-inline-end,margin-inline-start,margin-left,margin-right,margin-top,
	mask,mask-clip,mask-composite,mask-image,mask-mode,mask-origin,mask-position,mask-repeat,mask-size,max-height,
	max-width,min-height,min-width,mix-blend-mode,object-fit,object-position,opacity,order,orphans,outline,
	outline-color,outline-offset,outline-style,outline-width,overflow,overflow-anchor,overflow-wrap,overflow-x,
	overflow-y,overscroll-behavior,padding,padding-block,padding-block-end,padding-block-start,padding-bottom,
	padding-inline,padding-inline-end,padding-inline-start,padding-left,padding-right,padding-top,
	page-break-after,page-break-before,page-break-inside,paint-order,perspective,perspective-origin,place-content,
	place-items,place-self,pointer-events,position,quotes,resize,right,rotate,row-gap,scale,scroll-behavior,
	scrollbar-color,scrollbar-gutter,scrollbar-width,shape-image-threshold,shape-margin,shape-outside,tab-size,
	table-layout,text-align,text-align-last,text-decoration,text-decoration-color,text-decoration-line,
	text-decoration-skip-ink,text-decoration-style,text-decoration-thickness,text-emphasis,text-indent,
	text-justify,text-orientation,text-overflow,text-rendering,text-shadow,text-transform,
	text-underline-offset,top,touch-action,transform,transform-origin,transform-style,transition,transition-delay,
	transition-duration,transition-property,transition-timing-function,translate,unicode-bidi,user-select,
	vertical-align,visibility,white-space,widows,width,will-change,word-break,word-spacing,word-wrap,
	writing-mode,z-index,zoom,accent-color,content-visibility,forced-color-adjust,scroll-snap-align,
	scroll-snap-type,scroll-snap-stop,scroll-margin,scroll-padding
	`.split(",").map(s => s.trim()).filter(Boolean));
	    function cssLint(text, CMRef) {
	        const anns = [];
	        const pos = idx => {
	            const line = text.slice(0, idx).split("\n").length - 1;
	            const ch = idx - (text.lastIndexOf("\n", idx - 1) + 1);
	            return CMRef ? CMRef.Pos(line, ch) : { line, ch };
	        };
	        let bal = 0, i = 0, inStr = null;
	        while (i < text.length) {
	            const c = text[i];
	            if (inStr) { if (c === inStr) inStr = null; }
	            else if (c === '"' || c === "'") inStr = c;
	            else if (c === "/" && text[i + 1] === "*") {
	                const e = text.indexOf("*/", i + 2);
	                if (e === -1) { anns.push({ from: pos(i), to: pos(i + 2), severity: "error", message: "注释未闭合（缺 */）" }); break; }
	                i = e + 1;
	            }
	            else if (c === "{") bal++;
	            else if (c === "}") { bal--; if (bal < 0) { anns.push({ from: pos(i), to: pos(i + 1), severity: "error", message: "多余的 }" }); bal = 0; } }
	            i++;
	        }
	        if (bal > 0) anns.push({ from: pos(text.length), to: pos(text.length), severity: "error", message: `括号不配对：还有 ${bal} 个 { 未闭合` });
	        const declRe = /(?:^|[{;])\s*(-{0,2}[A-Za-z][\w-]*)\s*:/g;
	        let m;
	        while ((m = declRe.exec(text))) {
	            const prop = m[1];
	            if (prop.startsWith("--") || prop.startsWith("-")) continue;
	            if (!KNOWN_PROPS.has(prop.toLowerCase())) {
	                const idx = m.index + m[0].indexOf(prop);
	                anns.push({ from: pos(idx), to: pos(idx + prop.length), severity: "warning", message: `疑似无效属性：${prop}（检查拼写？）` });
	            }
	        }
	        const imps = [...text.matchAll(/!\s*important/gi)];
	        if (imps.length > 8) {
	            anns.push({ from: pos(imps[0].index), to: pos(imps[0].index + 9), severity: "info",
	                message: `!important 共出现 ${imps.length} 次——滥用会让覆盖链失效，建议降低优先级写法` });
	        }
	        return anns;
	    }
	    function formatCss(css, unit = "  ") {
	        css = String(css).replace(/\r\n?/g, "\n").trim();
	        let out = "", depth = 0, i = 0;
	        const n = css.length;
	        const atLineStart = () => out === "" || /(^|\n)[ \t]*$/.test(out);
	        const newLine = () => { if (!atLineStart()) out += "\n" + unit.repeat(depth); };
	        while (i < n) {
	            const c = css[i];
	            if (c === "/" && css[i + 1] === "*") {
	                const end = css.indexOf("*/", i + 2);
	                const stop = end === -1 ? n : end + 2;
	                newLine(); out += css.slice(i, stop); out += "\n" + unit.repeat(depth);
	                i = stop; continue;
	            }
	            if (c === '"' || c === "'") {
	                let j = i + 1;
	                while (j < n && css[j] !== c) { if (css[j] === "\\") j++; j++; }
	                out += css.slice(i, Math.min(j + 1, n)); i = j + 1; continue;
	            }
	            if (c === "{") { out = out.replace(/[ \t]+$/, "") + " {"; depth++; out += "\n" + unit.repeat(depth); i++; continue; }
	            if (c === "}") { depth = Math.max(0, depth - 1); out = out.replace(/[ \t]+$/, ""); if (!atLineStart()) out += "\n" + unit.repeat(depth); out += "}" + "\n" + unit.repeat(depth); i++; continue; }
	            if (c === ";") { out = out.replace(/[ \t]+$/, "") + ";" + "\n" + unit.repeat(depth); i++; continue; }
	            if (/\s/.test(c)) { if (!atLineStart() && !out.endsWith(" ")) out += " "; i++; continue; }
	            out += c; i++;
	        }
	        return out.replace(/\n[ \t]+(?=\n)/g, "\n").trim() + "\n";
	    }
	    async function createEditor(container, { value = "", onChange = null, onSave = null } = {}) {
	        try {
	            await ensureCodeMirror();
	            const cm = CodeMirror(container, {
	                value, mode: "css", theme: "material-darker",
	                lineNumbers: true, lineWrapping: true, indentUnit: 4, tabSize: 4,
	                autoCloseBrackets: true, matchBrackets: true, styleActiveLine: true,
	                foldGutter: true,
	                gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter", "CodeMirror-lint-markers"],
	                lint: { getAnnotations: t => cssLint(t, CodeMirror) },
	                extraKeys: {
	                    "Ctrl-S": () => onSave?.(), "Cmd-S": () => onSave?.(),
	                    "Ctrl-F": "findPersistent", "Shift-Ctrl-F": "replace", "Ctrl-G": "jumpToLine",
	                },
	            });
	            if (onChange) cm.on("change", () => onChange(cm.getValue()));
	            return {
	                kind: "codemirror",
	                getValue: () => cm.getValue(),
	                setValue: v => cm.setValue(v),
	                focus: () => cm.focus(),
	                refresh: () => cm.refresh(),
	                format: () => { const p = cm.getCursor(); cm.setValue(formatCss(cm.getValue())); cm.setCursor(p); },
	            };
	        }
	        catch (e) {
	            console.warn("[美化管理] CodeMirror 加载失败，降级纯文本编辑", e);
	            window.toastr?.info?.("CodeMirror 加载失败（网络原因），已降级为纯文本编辑：语法高亮与搜索暂不可用，其余功能正常");
	            const ta = document.createElement("textarea");
	            ta.className = "tm-plain-editor"; ta.value = value; ta.spellcheck = false;
	            container.appendChild(ta);
	            ta.addEventListener("input", () => onChange?.(ta.value));
	            return {
	                kind: "textarea",
	                getValue: () => ta.value, setValue: v => ta.value = v,
	                focus: () => ta.focus(), refresh: () => {},
	                format: () => { ta.value = formatCss(ta.value); onChange?.(ta.value); },
	            };
	        }
	    }
	    /* ================================================================
	     * 应用逻辑
	     * ================================================================ */
	    const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
	    const relTime = ts => {
	        const d = Date.now() - ts;
	        if (d < 60e3) return "刚刚"; if (d < 3600e3) return `${Math.floor(d / 60e3)} 分钟前`;
	        if (d < 86400e3) return `${Math.floor(d / 3600e3)} 小时前`; return `${Math.floor(d / 86400e3)} 天前`;
	    };
	    function createTheme({ name, css, author = "me", tags = [], scope = "global", version = "1.0.0" }) {
	        const id = `${String(name).trim().replace(/\s+/g, "-").toLowerCase()}-${Date.now().toString(36)}`;
	        return { id, name: String(name).trim(), author, version, tags, scope, rawCss: css, blocks: parseBlocks(css), updatedAt: Date.now(), preview: "" };
	    }
	    function addTheme(t) { S().themes[t.id] = t; saveSettingsDebounced(); return t; }
	    function placeholderGradient(t) {
	        const cols = [...String(t.rawCss).matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)/g)].map(m => m[0]).slice(0, 2);
	        const h = [...t.id].reduce((a, c) => a + c.charCodeAt(0), 0);
	        return `linear-gradient(135deg, ${cols[0] || `hsl(${h % 360} 45% 24%)`}, ${cols[1] || `hsl(${(h * 7) % 360} 55% 38%)`})`;
	    }
	    const DEFAULT_NEW_CSS = `/* @theme-block: bubble */
	.mes .mes_text {
	  background: rgba(255, 255, 255, 0.06);
	  border-radius: 14px;
	  padding: 10px 14px;
	}
	/* @theme-block: background */
	#chat {
	  background: linear-gradient(160deg, #1b1b2f, #16213e);
	}
	/* @theme-block: other */
	:root {
	  --theme-bg: #1b1b2f;
	  --accent: #7bd88f;
	}
	`;
	    /* ---------- M7 导入导出 ---------- */
	    function exportTheme(id) {
	        const t = S().themes[id];
	        const data = { name: t.name, author: t.author, version: t.version, tags: t.tags, scope: t.scope, css: t.rawCss };
	        if (t.preview) data.preview = t.preview;
	        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
	        Object.assign(document.createElement("a"), { href: url, download: `${t.id}.theme.json` }).click();
	        URL.revokeObjectURL(url);
	    }
	    async function importFromFile(file) {
	        try {
	            const o = JSON.parse(await file.text());
	            if (!o?.name || typeof o.css !== "string") throw new Error("theme.json 需要 name 与 css 字段");
	            const t = createTheme({ name: o.name, css: o.css, author: o.author || "unknown",
	                tags: Array.isArray(o.tags) ? o.tags : [], scope: o.scope || "global", version: o.version || "1.0.0" });
	            t.preview = typeof o.preview === "string" && o.preview.startsWith("data:image") ? o.preview : "";
	            addTheme(t); renderList();
	            toastr.success(`已导入：${o.name}`);
	        } catch (e) { toastr.error(`导入失败：${e.message}`); }
	    }
	    /* ---------- M4 混搭：当前块组合存为新主题 ---------- */
	    function saveCurrentMix() {
	        if (!S().activeIds.length) return toastr.warning("当前没有启用的主题，无组合可保存");
	        const css = S().activeIds.map(id => {
	            const t = S().themes[id]; if (!t) return "";
	            const tog = S().toggles[id] || {};
	            return Object.entries(t.blocks).filter(([n]) => tog[n] !== false)
	                .map(([n, c]) => `/* @theme-block: ${n} */\n${c}`).join("\n");
	        }).filter(Boolean).join("\n\n");
	        const t = addTheme(createTheme({ name: `Mix-${new Date().toISOString().slice(0, 10)}`, css, tags: ["mix"] }));
	        renderList();
	        toastr.success(`当前块组合已存为新主题：${t.name}`);
	    }
	    /* ---------- M1 库渲染 ---------- */
	    function visibleThemes() {
	        let arr = Object.values(S().themes);
	        const q = S().search.trim().toLowerCase();
	        if (q) arr = arr.filter(t => (t.name + " " + t.author + " " + t.tags.join(" ")).toLowerCase().includes(q));
	        if (S().tagFilter) arr = arr.filter(t => t.tags.includes(S().tagFilter));
	        if (S().favOnly) arr = arr.filter(t => S().favorites.includes(t.id));
	        const sorters = {
	            updated: (a, b) => b.updatedAt - a.updatedAt,
	            used:    (a, b) => (S().lastUsedAt[b.id] || 0) - (S().lastUsedAt[a.id] || 0),
	            uses:    (a, b) => (S().useCount[b.id] || 0) - (S().useCount[a.id] || 0),
	            name:    (a, b) => a.name.localeCompare(b.name, "zh"),
	        };
	        return arr.sort(sorters[S().sortBy] || sorters.updated);
	    }
	    function renderTags() {
	        const tags = [...new Set(Object.values(S().themes).flatMap(t => t.tags))].sort();
	        $("#tm_tags").empty().append(
	            tags.map(tag => `<button class="tm-chip ${S().tagFilter === tag ? "tm-on" : ""}" data-tag="${esc(tag)}">#${esc(tag)}</button>`).join(""));
	    }
	    function cardHtml(t) {
	        const active = S().activeIds.includes(t.id);
	        const fav = S().favorites.includes(t.id);
	        const kb = (new Blob([t.rawCss]).size / 1024).toFixed(1);
	        const tog = S().toggles[t.id] || {};
	        const scopeName = { global: "全局", character: "角色", chat: "聊天" }[t.scope] || t.scope;
	        return `
	    <div class="tm-card ${active ? "tm-active" : ""}" data-theme="${t.id}">
	      <div class="tm-thumb" style="background:${placeholderGradient(t)}">
	        ${t.preview ? `<img src="${t.preview}" alt="">` : `<span class="tm-thumb-none">无预览图</span>`}
	        <span class="tm-badge tm-badge-scope">${scopeName}</span>
	        ${active ? `<span class="tm-badge tm-badge-on">● 使用中</span>` : ""}
	        <button class="tm-fav ${fav ? "tm-on" : ""}" title="收藏">★</button>
	      </div>
	      <div class="tm-card-main">
	        <div class="tm-card-title" title="${esc(t.id)}">${esc(t.name)}</div>
	        <div class="tm-meta">${esc(t.author)} · ${kb}KB · ${relTime(t.updatedAt)} · 用过 ${S().useCount[t.id] || 0} 次</div>
	        <div class="tm-tags-row">${t.tags.map(x => `<span class="tm-chip sm" data-tag="${esc(x)}">#${esc(x)}</span>`).join("")}</div>
	        <div class="tm-blocks">
	          ${Object.keys(t.blocks).map(b => `<label title="组件块开关（M4）"><input type="checkbox" class="tm-block" data-theme="${t.id}" data-block="${esc(b)}" ${tog[b] !== false ? "checked" : ""}><span>${esc(b)}</span></label>`).join("")}
	        </div>
	        <div class="tm-actions">
	          <button class="menu_button tm-toggle">${active ? "⏹ 关闭" : "▶ 应用"}</button>
	          <button class="menu_button tm-edit">✏ 编辑</button>
	          <button class="menu_button tm-more" title="更多">⋯</button>
	        </div>
	        <div class="tm-menu tm-hidden"></div>
	      </div>
	    </div>`;
	    }
	    function toggleMoreMenu($btn) {
	        const $card = $btn.closest(".tm-card");
	        const $menu = $card.find(".tm-menu");
	        if (!$menu.hasClass("tm-hidden")) { $menu.addClass("tm-hidden"); return; }
	        $(".tm-menu").addClass("tm-hidden");
	        const id = $card.data("theme"), t = S().themes[id];
	        const hasFix = !!S().mobileFix[id];
	        $menu.html(`
	        <button class="tm-mi" data-act="export">📦 导出 JSON</button>
	        <button class="tm-mi" data-act="dup">⧉ 复制一份</button>
	        <button class="tm-mi" data-act="audit">📱 移动端体检</button>
	        <button class="tm-mi" data-act="fix">${hasFix ? "♻ 重新生成移动修复" : "🩹 一键移动修复"}</button>
	        ${hasFix ? `<button class="tm-mi" data-act="fixdel">🗑 删除移动修复层</button>` : ""}
	        ${t.preview ? `<button class="tm-mi" data-act="pvd">🧹 删除预览图</button>` : ""}
	        <button class="tm-mi tm-danger" data-act="del">🗑 删除主题</button>`).removeClass("tm-hidden");
	    }
	    function showReport(title, lines) {
	        $("#tm_report").remove();
	        $("body").append(`<div id="tm_report"><div class="tm-report">
	          <div class="tm-report-head"><b>${esc(title)}</b><button class="menu_button tm-report-close">✕</button></div>
	          <pre>${lines.map(esc).join("\n")}</pre></div></div>`);
	        $("#tm_report").on("click", e => { if (e.target.id === "tm_report") $("#tm_report").remove(); });
	        $(".tm-report-close").on("click", () => $("#tm_report").remove());
	    }
	    function renderQuickSwitch() {
	        const $q = $("#tm_quick").empty().append(`<option value="">⚡ 快速切换…</option>`);
	        const arr = Object.values(S().themes)
	            .sort((a, b) => (S().lastUsedAt[b.id] || b.updatedAt) - (S().lastUsedAt[a.id] || a.updatedAt));
	        for (const t of arr) $q.append(`<option value="${t.id}">${esc(t.name)}${S().activeIds.includes(t.id) ? " ●" : ""}</option>`);
	    }
	    function renderList() {
	        renderTags();
	        $("#tm_view").text(S().viewMode === "grid" ? "▦" : "☰");
	        $("#tm_fav_filter").toggleClass("tm-on", !!S().favOnly);
	        const $list = $("#tm_list").attr("data-view", S().viewMode);
	        const st = $list.scrollTop();
	        $list.empty();
	        const arr = visibleThemes();
	        if (!arr.length) $list.append('<div class="tm-empty">没有匹配的主题。可「➕新建」或「导入」。</div>');
	        else for (const t of arr) $list.append(cardHtml(t));
	        $list.scrollTop(st);
	        renderQuickSwitch();
	    }
	    /* ---------- M2+M3.1 编辑屏 ---------- */
	    const ED = { themeId: null, editor: null, preview: null, built: false, dirty: false, liveTimer: null };
	    async function openEditor(themeId) {
	        if (ED.dirty && !confirm("当前编辑有未保存改动，仍要切换主题？")) return;
	        const t = S().themes[themeId]; if (!t) return;
	        ED.themeId = themeId;
	        $("#tm_edit_name").val(t.name);
	        if (!ED.built) {
	            ED.built = true;
	            ED.editor = await createEditor($("#tm_edit_code")[0], {
	                value: "",
	                onChange: v => {
	                    ED.dirty = true;
	                    clearTimeout(ED.liveTimer);
	                    ED.liveTimer = setTimeout(() => ED.preview?.setCss(v), 300);
	                },
	                onSave: () => saveEditor(),
	            });
	            ED.preview = new PreviewManager($("#tm_edit_prev"), {
	                onCapture: async () => {
	                    try {
	                        const url = await ED.preview.capturePng();
	                        if (S().themes[ED.themeId]) { S().themes[ED.themeId].preview = url; saveSettingsDebounced(); renderList(); }
	                        toastr.success("预览图已生成并保存到主题");
	                    } catch (e) { toastr.error(e.message); }
	                },
	            });
	            ED.preview.mount();
	        }
	        ED.editor.setValue(t.rawCss);
	        ED.dirty = false;
	        ED.preview.setCss(t.rawCss);
	        $("#tm_edit").removeClass("tm-hidden");
	        requestAnimationFrame(() => { ED.editor.refresh(); ED.preview.relayout(); });
	        ED.editor.focus();
	    }
	    function closeEditor() {
	        if (ED.dirty && !confirm("有未保存改动，仍要离开编辑器？")) return;
	        $("#tm_edit").addClass("tm-hidden");
	    }
	    function saveEditor() {
	        const t = S().themes[ED.themeId]; if (!t) return;
	        const css = ED.editor.getValue();
	        t.rawCss = css;
	        t.blocks = parseBlocks(css);
	        t.name = $("#tm_edit_name").val().trim() || t.name;
	        t.updatedAt = Date.now();
	        const tog = S().toggles[t.id] || {};
	        for (const k of Object.keys(tog)) if (!(k in t.blocks)) delete tog[k];
	        saveSettingsDebounced();
	        if (S().activeIds.includes(t.id)) refreshAll();
	        renderList();
	        ED.dirty = false;
	        toastr.success(`已保存：${t.name}`);
	    }
	    /* ---------- 面板骨架 ---------- */
	    function addMenuEntry() {
	        $("<div>", { id: "tm_menu_entry", class: "list-group-item flex-container flexGap5" })
	            .append($("<i>", { class: "fa-solid fa-palette extensionsMenuExtensionButton", title: "美化管理" }))
	            .append($("<span>", { text: "美化管理" }))
	            .on("click", togglePanel)
	            .appendTo("#extensionsMenu");
	    }
	    const togglePanel = () => $("#tm_panel").toggleClass("tm-hidden");
	    function buildPanel() {
	        $("body").append(`
	    <div id="tm_panel" class="tm-hidden">
	      <div class="tm-head">
	        <b>🎨 美化管理</b>
	        <span class="tm-head-btns">
	          <select id="tm_quick" title="快速切换（单开替换；要保留组合请先「存组合」）"></select>
	          <button id="tm_new" class="menu_button" title="新建空白主题">➕ 新建</button>
	          <button id="tm_mix" class="menu_button" title="把当前启用的块组合存成新主题（M4 混搭）">💾 存组合</button>
	          <button id="tm_import" class="menu_button">导入</button>
	          <input id="tm_file" type="file" accept=".json" hidden>
	          <button id="tm_disable_all" class="menu_button" title="全部关闭，对比原版">原版</button>
	          <button id="tm_close" class="menu_button">✕</button>
	        </span>
	      </div>
	      <div class="tm-toolbar">
	        <input id="tm_search" class="text_pole" placeholder="🔍 搜名称 / 作者 / 标签…" value="${esc(S().search)}">
	        <select id="tm_sort" title="排序">
	          <option value="updated">最近更新</option><option value="used">最近使用</option>
	          <option value="uses">使用次数</option><option value="name">名称</option>
	        </select>
	        <button id="tm_fav_filter" class="menu_button" title="只看收藏">★</button>
	        <button id="tm_view" class="menu_button" title="网格 / 列表切换">▦</button>
	      </div>
	      <div id="tm_tags" class="tm-tags"></div>
	      <div id="tm_list"></div>
	    </div>
	    <div id="tm_edit" class="tm-hidden">
	      <div class="tm-edit-head">
	        <button id="tm_edit_back" class="menu_button">← 返回库</button>
	        <input id="tm_edit_name" class="text_pole" placeholder="主题名称">
	        <span class="tm-edit-info">左：代码 · 右：实时预览（≈300ms）｜ Ctrl+S 保存 · Ctrl+F 搜索 · Shift+Ctrl+F 替换</span>
	        <button id="tm_edit_format" class="menu_button" title="一键格式化">🧹 格式化</button>
	        <button id="tm_edit_save" class="menu_button">💾 保存</button>
	      </div>
	      <div class="tm-edit-body">
	        <div id="tm_edit_code"></div>
	        <div id="tm_edit_prev"></div>
	      </div>
	    </div>`);
	        $("#tm_close").on("click", () => $("#tm_panel").addClass("tm-hidden"));
	        $("#tm_disable_all").on("click", () => { S().activeIds = []; saveSettingsDebounced(); refreshAll(); renderList(); });
	        $("#tm_import").on("click", () => $("#tm_file").trigger("click"));
	        $("#tm_file").on("change", e => { [...e.target.files].forEach(importFromFile); e.target.value = ""; });
	        $("#tm_new").on("click", () => { const t = addTheme(createTheme({ name: "未命名主题", css: DEFAULT_NEW_CSS })); renderList(); openEditor(t.id); });
	        $("#tm_mix").on("click", saveCurrentMix);
	        let st;
	        $("#tm_search").on("input", function () { clearTimeout(st); const v = this.value; st = setTimeout(() => { S().search = v; renderList(); }, 200); });
	        $("#tm_sort").on("change", function () { S().sortBy = this.value; saveSettingsDebounced(); renderList(); });
	        $("#tm_fav_filter").on("click", () => { S().favOnly = !S().favOnly; saveSettingsDebounced(); renderList(); });
	        $("#tm_view").on("click", () => { S().viewMode = S().viewMode === "grid" ? "list" : "grid"; saveSettingsDebounced(); renderList(); });
	        $("#tm_quick").on("change", function () {
	            const id = this.value; this.selectedIndex = 0; if (!id) return;
	            S().activeIds = [];
	            enableTheme(id); renderList();
	        });
	        $("#tm_edit_back").on("click", closeEditor);
	        $("#tm_edit_save").on("click", saveEditor);
	        $("#tm_edit_format").on("click", () => ED.editor?.format());
	        $("#tm_panel")
	            .on("click", ".tm-toggle", function () {
	                const id = $(this).closest(".tm-card").data("theme");
	                S().activeIds.includes(id) ? disableTheme(id) : enableTheme(id);
	                renderList();
	            })
	            .on("click", ".tm-edit", function () { openEditor($(this).closest(".tm-card").data("theme")); })
	            .on("click", ".tm-more", function () { toggleMoreMenu($(this)); })
	            .on("click", ".tm-fav", function () {
	                const id = $(this).closest(".tm-card").data("theme");
	                S().favorites = S().favorites.includes(id) ? S().favorites.filter(x => x !== id) : [...S().favorites, id];
	                saveSettingsDebounced(); renderList();
	            })
	            .on("change", ".tm-block", function () {
	                setBlockToggle($(this).data("theme"), $(this).data("block"), this.checked);
	            })
	            .on("click", ".tm-chip[data-tag]", function () {
	                const tag = String($(this).data("tag"));
	                S().tagFilter = S().tagFilter === tag ? "" : tag;
	                saveSettingsDebounced(); renderList();
	            })
	            .on("click", ".tm-mi", function () {
	                const id = $(this).closest(".tm-card").data("theme");
	                const act = $(this).data("act");
	                const t = S().themes[id]; if (!t) return;
	                $(".tm-menu").addClass("tm-hidden");
	                switch (act) {
	                    case "export": exportTheme(id); break;
	                    case "dup": { const c = createTheme({ name: t.name + " 副本", css: t.rawCss, author: t.author, tags: [...t.tags], scope: t.scope }); addTheme(c); renderList(); break; }
	                    case "audit": showReport(`📱 移动端体检 · ${t.name}`, auditMobile(buildActiveCss(t, S().toggles[id]))); break;
	                    case "fix": S().mobileFix[id] = { enabled: true, css: buildMobileFix() }; saveSettingsDebounced(); refreshAll(); toastr.success("mobile-fix 独立层已生成并启用"); break;
	                    case "fixdel": delete S().mobileFix[id]; saveSettingsDebounced(); refreshAll(); toastr.info("移动修复层已删除"); break;
	                    case "pvd": t.preview = ""; saveSettingsDebounced(); renderList(); break;
	                    case "del":
	                        if (!confirm(`删除主题「${t.name}」？`)) return;
	                        disableTheme(id);
	                        delete S().themes[id]; delete S().toggles[id]; delete S().mobileFix[id];
	                        S().favorites = S().favorites.filter(x => x !== id);
	                        saveSettingsDebounced(); refreshAll(); renderList();
	                        break;
	                }
	            });
	        document.addEventListener("keydown", e => {
	            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !$("#tm_edit").hasClass("tm-hidden")) { e.preventDefault(); saveEditor(); }
	            else if (e.key === "Escape" && !$("#tm_edit").hasClass("tm-hidden")) closeEditor();
	            else if (e.ctrlKey && e.shiftKey && e.code === "KeyB") { e.preventDefault(); togglePanel(); }
	        });
	        $(document).on("click", e => { if (!$(e.target).closest(".tm-card").length) $(".tm-menu").addClass("tm-hidden"); });
	    }
	    /* ---------- M8 失效哨兵雏形 ---------- */
	    function sentinel() {
	        if (S().activeIds.length && !document.querySelector("#chat, #send_form")) {
	            toastr.warning("主题选择器未命中 #chat/#send_form，此主题可能已过期（酒馆版本变动？）");
	        }
	    }
	    /* ---------- 入口 ---------- */
	    function boot() {
	        loadSettings();
	        addMenuEntry();
	        buildPanel();
	        $("#tm_sort").val(S().sortBy);
	        renderList();
	        refreshAll();
	        if (event_types?.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, () => { refreshAll(); sentinel(); });
	        if (event_types?.CHARACTER_MESSAGE_RENDERED) eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, sentinel);
	    }
	    jQuery(boot);
	})();
