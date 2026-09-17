	/**
	 * 美化管理 Theme Manager v0.1
	 * 已落地：工程骨架（注入层/持久化/事件）+ M4 组件模块化 + M9 移动端分析
	 *        + M1 基础面板 + M7 JSON 导入导出 + M12 快捷键
	 */
	import { extension_settings } from "../../../scripts/extensions.js";
	import { saveSettingsDebounced } from "../../../scripts/save-settings.js";
	import { eventSource, event_types } from "../../../script.js";
	const EXT = "st_theme_manager";
	const S = () => extension_settings[EXT];
	/* ========== 工程骨架：数据持久化（extension_settings） ========== */
	const DEFAULTS = {
	    enabled: true,
	    themes: {},       // id -> { id,name,author,version,tags,scope,rawCss,blocks,updatedAt }
	    activeIds: [],    // 多主题同开（为 M8 冲突检测预留架构位）
	    toggles: {},      // themeId -> { 块名: bool }
	    mobileFix: {},    // themeId -> { css, enabled }（M9 独立修复层）
	};
	function loadSettings() {
	    if (!extension_settings[EXT]) extension_settings[EXT] = structuredClone(DEFAULTS);
	    for (const k of Object.keys(DEFAULTS)) {
	        if (S()[k] === undefined) S()[k] = structuredClone(DEFAULTS[k]); // 升级兼容
	    }
	}
	/* ========== 工程骨架：样式注入层（独立 <style>，绝不碰 power_user.custom_css） ========== */
	function applyTheme(theme) {
	    const css = [
	        buildActiveCss(theme),                                                  // M4
	        S().mobileFix[theme.id]?.enabled ? S().mobileFix[theme.id].css : "",    // M9 独立层
	    ].filter(Boolean).join("\n");
	    let el = document.head.querySelector(`style[data-theme-id="${CSS.escape(theme.id)}"]`);
	    if (!el) {
	        el = document.createElement("style");
	        el.setAttribute("data-theme-id", theme.id);
	        document.head.appendChild(el);
	    }
	    el.textContent = css;
	}
	function refreshAll() {
	    // 摘除已停用/已删除主题的 <style>
	    document.head.querySelectorAll("style[data-theme-id]").forEach(el => {
	        if (!S().activeIds.includes(el.getAttribute("data-theme-id"))) el.remove();
	    });
	    S().activeIds = S().activeIds.filter(id => S().themes[id]);
	    for (const id of S().activeIds) applyTheme(S().themes[id]);
	}
	function enableTheme(id) {
	    if (S().themes[id] && !S().activeIds.includes(id)) S().activeIds.push(id);
	    saveSettingsDebounced(); refreshAll();
	}
	function disableTheme(id) {
	    S().activeIds = S().activeIds.filter(x => x !== id);
	    saveSettingsDebounced(); refreshAll();
	}
	/* ========== M4 组件模块化：CSS 拆块 / 块级开关 / 混搭 ========== */
	// 约定：CSS 内用 /* @theme-block: bubble */ 声明块边界
	// 推荐块名：bubble / input / avatar / topbar / background / animation / other
	function parseBlocks(css) {
	    const marks = [...css.matchAll(/\/\*\s*@theme-block:\s*([\w-]+)\s*\*\//g)];
	    if (!marks.length) return { other: css.trim() };  // 无标记 → 整体一块
	    const blocks = {};
	    if (marks[0].index > 0) blocks.other = css.slice(0, marks[0].index).trim();
	    marks.forEach((m, i) => {
	        const start = m.index + m[0].length;
	        const end = i + 1 < marks.length ? marks[i + 1].index : css.length;
	        blocks[m[1]] = css.slice(start, end).trim();
	    });
	    return blocks;
	}
	// 只拼装启用的块（未设开关 = 默认启用）→ 天然支持混搭：A 只开 bubble，B 只开 background
	function buildActiveCss(theme) {
	    const t = S().toggles[theme.id] || {};
	    return Object.entries(theme.blocks)
	        .filter(([name]) => t[name] !== false)
	        .map(([, css]) => `/* block of ${theme.id} */\n${css}`)
	        .join("\n\n");
	}
	function setBlockToggle(themeId, block, on) {
	    (S().toggles[themeId] ||= {})[block] = on;
	    saveSettingsDebounced(); refreshAll();
	}
	/* ========== M9 移动端优化：静态分析 + 一键修复 ========== */
	const MOBILE_RULES = [
	    { re: /(?:width|height)\s*:\s*(\d{4,})px/g, lv: "❌", hint: m => `固定 ${m[1]}px 超出手机视口(390px)，建议 max-width/百分比` },
	    { re: /min-width\s*:\s*([5-9]\d{2,})px/g, lv: "❌", hint: m => `min-width:${m[1]}px 会撑破 390px 视口` },
	    { re: /padding\s*:\s*(\d{3,})px/g, lv: "⚠️", hint: m => `padding:${m[1]}px 过大，移动端建议 ≤32px` },
	    { re: /position\s*:\s*fixed/g, lv: "⚠️", hint: () => "position:fixed 易遮挡手机输入区，建议包进 @media (hover:hover)" },
	];
	function auditMobile(themeId) {
	    const css = buildActiveCss(S().themes[themeId]);
	    const issues = [];
	    for (const r of MOBILE_RULES) {
	        r.re.lastIndex = 0;
	        let m;
	        while ((m = r.re.exec(css))) {
	            issues.push(`L${css.slice(0, m.index).split("\n").length} ${r.lv} ${r.hint(m)}`);
	        }
	    }
	    // hover-only 检测（行级简化版）
	    css.split("\n").forEach((l, i) => {
	        if (/:(hover)\b/.test(l) && !/@media/.test(l)) {
	            issues.push(`L${i + 1} ℹ️ :hover 在触屏无效，建议补 :active/:focus-visible`);
	        }
	    });
	    return issues.length ? issues : ["✅ 未发现明显移动端问题"];
	}
	// 一键生成 mobile-fix.css（独立层，关掉/删除即完全还原）
	function generateMobileFix(themeId) {
	    const t = S().themes[themeId];
	    S().mobileFix[themeId] = {
	        enabled: true,
	        css: `/* auto mobile-fix for "${t.name}" */\n@media (max-width: 425px) {\n  #chat, .mes, .mes_block, #send_form { min-width: 0 !important; width: 100% !important; }\n  .mes { padding: 8px !important; }\n}`,
	    };
	    saveSettingsDebounced(); refreshAll();
	}
	/* ========== M7 导入导出（v0.1：JSON 格式） ========== */
	function exportTheme(themeId) {
	    const t = S().themes[themeId];
	    const meta = { name: t.name, author: t.author, version: t.version, tags: t.tags, scope: t.scope, css: t.rawCss };
	    const url = URL.createObjectURL(new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" }));
	    Object.assign(document.createElement("a"), { href: url, download: `${t.id}.theme.json` }).click();
	    URL.revokeObjectURL(url);
	}
	function importThemeFromObject(o) {
	    if (!o?.name || typeof o.css !== "string") throw new Error("theme.json 需要 name 与 css 字段");
	    const id = `${String(o.name).trim().replace(/\s+/g, "-").toLowerCase()}-${Date.now().toString(36)}`;
	    S().themes[id] = {
	        id, name: o.name, author: o.author || "unknown", version: o.version || "1.0.0",
	        tags: Array.isArray(o.tags) ? o.tags : [], scope: o.scope || "global",
	        rawCss: o.css, blocks: parseBlocks(o.css), updatedAt: Date.now(),
	    };
	}
	async function importFromFile(file) {
	    try {
	        importThemeFromObject(JSON.parse(await file.text()));
	        saveSettingsDebounced(); renderList();
	        toastr.success("主题导入成功");
	    } catch (e) { toastr.error(`导入失败：${e.message}`); }
	}
	/* ========== M1 基础面板 ========== */
	function addMenuEntry() {
	    $("<div>", { id: "tm_menu_entry", class: "list-group-item flex-container flexGap5" })
	        .append($("<i>", { class: "fa-solid fa-palette extensionsMenuExtensionButton", title: "美化管理" }))
	        .append($("<span>", { text: "美化管理" }))
	        .on("click", togglePanel)
	        .appendTo("#extensionsMenu");
	}
	function buildPanel() {
	    $("body").append(`
	    <div id="tm_panel" class="tm-hidden">
	      <div class="tm-head">
	        <b>🎨 美化管理</b>
	        <span>
	          <button id="tm_import" class="menu_button">导入JSON</button>
	          <input id="tm_file" type="file" accept=".json" hidden>
	          <button id="tm_disable_all" class="menu_button">全部关闭</button>
	          <button id="tm_close" class="menu_button">✕</button>
	        </span>
	      </div>
	      <div id="tm_list"></div>
	    </div>`);
	    $("#tm_close").on("click", () => $("#tm_panel").addClass("tm-hidden"));
	    $("#tm_disable_all").on("click", () => { S().activeIds = []; saveSettingsDebounced(); refreshAll(); renderList(); }); // M1: 一键关闭全部（对比原版）
	    $("#tm_import").on("click", () => $("#tm_file").trigger("click"));
	    $("#tm_file").on("change", e => { [...e.target.files].forEach(importFromFile); e.target.value = ""; });
	    // 事件委托
	    $("#tm_panel")
	        .on("click", ".tm-toggle", e => {
	            const id = $(e.currentTarget).data("theme");
	            S().activeIds.includes(id) ? disableTheme(id) : enableTheme(id);
	            renderList();
	        })
	        .on("change", ".tm-block", e => setBlockToggle(
	            $(e.currentTarget).data("theme"), $(e.currentTarget).data("block"), e.target.checked))
	        .on("click", ".tm-audit", e => {
	            const id = $(e.currentTarget).data("theme");
	            $(`.tm-report[data-theme="${id}"]`).text(auditMobile(id).join("\n")).toggle();
	        })
	        .on("click", ".tm-fix", e => { generateMobileFix($(e.currentTarget).data("theme")); toastr.success("mobile-fix 层已生成并启用"); })
	        .on("click", ".tm-export", e => exportTheme($(e.currentTarget).data("theme")))
	        .on("click", ".tm-del", e => {
	            const id = $(e.currentTarget).data("theme");
	            disableTheme(id);
	            delete S().themes[id]; delete S().toggles[id]; delete S().mobileFix[id];
	            saveSettingsDebounced(); renderList();
	        });
	}
	function togglePanel() { $("#tm_panel").toggleClass("tm-hidden"); }
	function renderList() {
	    const $list = $("#tm_list").empty();
	    const themes = Object.values(S().themes).sort((a, b) => b.updatedAt - a.updatedAt);
	    if (!themes.length) { $list.append('<div class="tm-empty">暂无主题，点右上「导入JSON」试试</div>'); return; }
	    for (const t of themes) {
	        const active = S().activeIds.includes(t.id);
	        const toggles = S().toggles[t.id] || {};
	        $list.append(`
	        <div class="tm-card ${active ? "tm-active" : ""}">
	            <div class="tm-row"><b>${t.name}</b>
	                <button class="menu_button tm-toggle" data-theme="${t.id}">${active ? "关闭" : "应用"}</button></div>
	            <div class="tm-meta">${t.author} · v${t.version} · ${t.tags.join(" / ") || "无标签"}</div>
	            <div class="tm-blocks">
	                ${Object.keys(t.blocks).map(b => `
	                    <label><input type="checkbox" class="tm-block" data-theme="${t.id}" data-block="${b}"
	                        ${toggles[b] !== false ? "checked" : ""}>${b}</label>`).join("")}
	            </div>
	            <div class="tm-row tm-foot">
	                <button class="menu_button tm-audit" data-theme="${t.id}">📱体检</button>
	                <button class="menu_button tm-fix" data-theme="${t.id}">一键修复</button>
	                <button class="menu_button tm-export" data-theme="${t.id}">导出</button>
	                <button class="menu_button tm-del" data-theme="${t.id}">删除</button>
	            </div>
	            <pre class="tm-report" data-theme="${t.id}" style="display:none"></pre>
	        </div>`);
	    }
	}
	/* ========== 工程骨架：事件挂载 + M8 失效哨兵雏形 ========== */
	function sentinel() {
	    if (S().activeIds.length && !document.querySelector("#chat, #send_form")) {
	        toastr.warning("主题选择器未命中 #chat/#send_form，此主题可能已过期（酒馆版本变动？）");
	    }
	}
	jQuery(async () => {
	    loadSettings();
	    addMenuEntry();
	    buildPanel();
	    renderList();
	    refreshAll();   // 会话恢复：自动重挂上次启用的主题
	    eventSource.on(event_types.CHAT_CHANGED, () => { refreshAll(); sentinel(); });
	    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, sentinel);
	    // M12：Ctrl+Shift+B 开关面板
	    document.addEventListener("keydown", e => {
	        if (e.ctrlKey && e.shiftKey && e.code === "KeyB") { e.preventDefault(); togglePanel(); }
	    });
	});
