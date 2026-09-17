	/**
	 * 美化管理 Theme Manager v0.5
	 * 沿用 v0.1 骨架：注入层 / 持久化 / 多开架构 / M4 块开关 / M9 体检
	 * 本版新增：M1 完整（网格列表/搜索/标签/收藏/统计/快速切换/作用域角标）
	 *          M2 预览系统（iframe 沙盒/设备切换/条数模拟/快照/渐变占位/分屏实时）
	 *          M3.1 代码模式（高亮/行号/折叠/搜索替换/格式化/括号匹配/lint）
	 *          M4 混搭落地（当前启用块组合 → 存为新主题）
	 */
	import { extension_settings } from "../../../scripts/extensions.js";
	import { saveSettingsDebounced } from "../../../scripts/save-settings.js";
	import { eventSource, event_types } from "../../../script.js";
	import { parseBlocks, buildActiveCss, auditMobile, buildMobileFix } from "./lib/core.js";
	import { PreviewManager } from "./lib/preview.js";
	import { createEditor } from "./lib/editor.js";
	const EXT = "st_theme_manager";
	const S = () => extension_settings[EXT];
	/* ============ 工程骨架：持久化（v0.1 数据自动升级兼容） ============ */
	const DEFAULTS = {
	    enabled: true,
	    themes: {}, activeIds: [], toggles: {}, mobileFix: {},
	    viewMode: "grid", favorites: [], lastUsedAt: {}, useCount: {},
	    sortBy: "updated", search: "", tagFilter: "", favOnly: false,
	};
	function loadSettings() {
	    if (!extension_settings[EXT]) extension_settings[EXT] = structuredClone(DEFAULTS);
	    for (const k of Object.keys(DEFAULTS)) if (S()[k] === undefined) S()[k] = structuredClone(DEFAULTS[k]);
	}
	/* ============ 工程骨架：样式注入层（不碰 power_user.custom_css） ============ */
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
	    S().lastUsedAt[id] = Date.now();                  // M1 最近使用
	    S().useCount[id] = (S().useCount[id] || 0) + 1;   // M1 使用次数
	    saveSettingsDebounced(); refreshAll();
	}
	function disableTheme(id) { S().activeIds = S().activeIds.filter(x => x !== id); saveSettingsDebounced(); refreshAll(); }
	function setBlockToggle(themeId, block, on) { (S().toggles[themeId] ||= {})[block] = on; saveSettingsDebounced(); refreshAll(); }
	/* ============ 工具 ============ */
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
	// M2：无预览图 → 主色渐变占位（取主题里前两个颜色，否则按 id 哈希生成）
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
	/* ============ M7 导入导出（JSON） ============ */
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
	/* ============ M4：跨主题混搭 —— 当前启用块组合存为新主题 ============ */
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
	/* ============ M1 完整：筛选 / 排序 / 卡片 ============ */
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
	/* ============ M2 + M3.1：编辑屏（左代码右预览，实时生效） ============ */
	const ED = { themeId: null, editor: null, preview: null, built: false, dirty: false, liveTimer: null };
	async function openEditor(themeId) {
	    if (ED.dirty && !confirm("当前编辑有未保存改动，仍要切换主题？")) return;
	    const t = S().themes[themeId]; if (!t) return;
	    ED.themeId = themeId;
	    $("#tm_edit_name").val(t.name);
	    if (!ED.built) {                                   // 惰性创建，只建一次
	        ED.built = true;
	        ED.editor = await createEditor($("#tm_edit_code")[0], {
	            value: "",
	            onChange: v => {                           // M2 分屏实时：300ms 防抖注入预览
	                ED.dirty = true;
	                clearTimeout(ED.liveTimer);
	                ED.liveTimer = setTimeout(() => ED.preview?.setCss(v), 300);
	            },
	            onSave: () => saveEditor(),
	        });
	        ED.preview = new PreviewManager($("#tm_edit_prev"), {
	            onCapture: async () => {                   // 📸 快照 → 存进主题（库内展示/分享）
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
	    const tog = S().toggles[t.id] || {};               // 清理已不存在的块开关
	    for (const k of Object.keys(tog)) if (!(k in t.blocks)) delete tog[k];
	    saveSettingsDebounced();
	    if (S().activeIds.includes(t.id)) refreshAll();    // 使用中 → 立即应用到真页面
	    renderList();
	    ED.dirty = false;
	    toastr.success(`已保存：${t.name}`);
	}
	/* ============ 面板骨架 ============ */
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
	        <span class="tm-edit-info">左：代码 · 右：实时预览（≈300ms）｜ Ctrl+S 保存 · Ctrl+F 搜索 · Shift+Ctrl+F 替换 · 行号旁箭头折叠</span>
	        <button id="tm_edit_format" class="menu_button" title="一键格式化">🧹 格式化</button>
	        <button id="tm_edit_save" class="menu_button">💾 保存</button>
	      </div>
	      <div class="tm-edit-body">
	        <div id="tm_edit_code"></div>
	        <div id="tm_edit_prev"></div>
	      </div>
	    </div>`);
	    /* ---- 库：顶栏 ---- */
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
	        S().activeIds = [];            // 快速切换 = 单开替换（组合请先「存组合」）
	        enableTheme(id); renderList();
	    });
	    /* ---- 编辑屏 ---- */
	    $("#tm_edit_back").on("click", closeEditor);
	    $("#tm_edit_save").on("click", saveEditor);
	    $("#tm_edit_format").on("click", () => ED.editor?.format());
	    /* ---- 库：卡片事件委托 ---- */
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
	            setBlockToggle($(this).data("theme"), $(this).data("block"), this.checked);   // 实时生效，不重渲染防抖动
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
	    /* ---- 全局快捷键（M12） ---- */
	    document.addEventListener("keydown", e => {
	        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !$("#tm_edit").hasClass("tm-hidden")) { e.preventDefault(); saveEditor(); }
	        else if (e.key === "Escape" && !$("#tm_edit").hasClass("tm-hidden")) closeEditor();
	        else if (e.ctrlKey && e.shiftKey && e.code === "KeyB") { e.preventDefault(); togglePanel(); }
	    });
	    // 点空白处收起「更多」菜单
	    $(document).on("click", e => { if (!$(e.target).closest(".tm-card").length) $(".tm-menu").addClass("tm-hidden"); });
	}
	/* ============ M8 失效哨兵雏形 ============ */
	function sentinel() {
	    if (S().activeIds.length && !document.querySelector("#chat, #send_form")) {
	        toastr.warning("主题选择器未命中 #chat/#send_form，此主题可能已过期（酒馆版本变动？）");
	    }
	}
	/* ============ 入口 ============ */
	jQuery(async () => {
	    loadSettings();
	    addMenuEntry();
	    buildPanel();
	    $("#tm_sort").val(S().sortBy);
	    renderList();
	    refreshAll();   // 会话恢复：自动重挂上次启用的主题
	    eventSource.on(event_types.CHAT_CHANGED, () => { refreshAll(); sentinel(); });
	    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, sentinel);
	});
