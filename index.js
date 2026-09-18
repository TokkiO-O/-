/**
 * 美化管理 Theme Manager v0.7.1（推倒重建）
 *
 * 工程骨架 + M1 库 + M2 iframe沙盒分屏预览 + M3.1 代码编辑
 * + M4 块开关 + M7 导入导出 + M9 移动体检 + 酒馆同步
 *
 * 原则：独立 style[data-theme-id]；预览图只进 IDB；编辑=真实页面注入
 */
(async () => {
    const PREFIXES = ["../../../../", "../../../", "/", "../../../../../../"];
    async function probe(file, { optional = false } = {}) {
        const tried = [];
        for (const p of PREFIXES) {
            try { return await import(p + file); }
            catch (e) { tried.push(`${p}${file}: ${e?.message ?? e}`); }
        }
        if (!optional) console.error(`[美化管理] ${file} 失败\n` + tried.join("\n"));
        if (optional) return {};
        throw new Error(file);
    }

    let extension_settings, eventSource, event_types, saveSettingsDebounced;
    let power_user = null;
    try {
        ({ extension_settings } = await probe("scripts/extensions.js"));
        const scriptMod = await probe("script.js");
        eventSource = scriptMod.eventSource;
        event_types = scriptMod.event_types;
        try { saveSettingsDebounced = (await probe("scripts/save-settings.js", { optional: true })).saveSettingsDebounced; } catch {}
        try { const pu = await probe("scripts/power-user.js", { optional: true }); power_user = pu?.power_user ?? null; } catch {}
    } catch (e) {
        console.error("[美化管理] 核心模块加载失败", e);
        return;
    }
    if (typeof saveSettingsDebounced !== "function") saveSettingsDebounced = () => {};

    const EXT = "st_theme_manager";
    const ED = { themeId: null, editor: null, preview: null, built: false, dirty: false, liveTimer: null };
    const DEFAULTS = {
        enabled: true, themes: {}, activeIds: [], toggles: {}, mobileFix: {},
        viewMode: "grid", favorites: [], lastUsedAt: {}, useCount: {},
        sortBy: "updated", search: "", tagFilter: "", favOnly: false, tavernDeleted: [],
    };
    const clone = o => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
    const S = () => extension_settings[EXT];

    function loadSettings() {
        if (!extension_settings[EXT]) extension_settings[EXT] = clone(DEFAULTS);
        for (const k of Object.keys(DEFAULTS)) if (S()[k] === undefined) S()[k] = clone(DEFAULTS[k]);
        for (const t of Object.values(S().themes || {})) {
            if (!t) continue;
            if (t.preview) delete t.preview;
            if (typeof t.rawCss === "string") t.blocks = parseBlocks(t.rawCss);
            if (!t.blocks) t.blocks = { other: t.rawCss || "" };
        }
    }
    const __save = saveSettingsDebounced;
    saveSettingsDebounced = function tmSave() {
        try {
            const bag = extension_settings[EXT];
            if (bag?.themes) for (const t of Object.values(bag.themes)) if (t && "preview" in t) delete t.preview;
        } catch {}
        return __save.apply(this, arguments);
    };

    const previewMem = new Map();
    const previewHydrated = new Set();
    const IDB_NAME = "st_theme_manager_previews";
    const IDB_STORE = "previews";
    function openPreviewDB() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) return reject(new Error("no idb"));
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error("idb open fail"));
        });
    }
    async function idbGet(id) {
        try {
            const db = await openPreviewDB();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, "readonly");
                const r = tx.objectStore(IDB_STORE).get(id);
                r.onsuccess = () => resolve(r.result || "");
                r.onerror = () => reject(r.error);
            });
        } catch { return ""; }
    }
    async function idbSet(id, dataUrl) {
        try {
            const db = await openPreviewDB();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, "readwrite");
                tx.objectStore(IDB_STORE).put(dataUrl || "", id);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) { console.warn("[美化管理] IDB 写预览失败", e); }
    }
    function getPreviewSync(id) { return previewMem.get(id) || ""; }
    async function hydratePreview(id) {
        if (previewMem.has(id)) return previewMem.get(id);
        if (previewHydrated.has(id)) return "";
        const v = await idbGet(id);
        previewHydrated.add(id);
        if (v) previewMem.set(id, v);
        return v || "";
    }
    async function setPreview(id, dataUrl) {
        previewHydrated.add(id);
        if (dataUrl) previewMem.set(id, dataUrl); else previewMem.delete(id);
        if (dataUrl) await idbSet(id, dataUrl);
    }

    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

    function parseBlocks(css) {
        const src = String(css || "");
        const marks = [...src.matchAll(/\/\*\s*@theme-block:\s*([\w-]+)\s*\*\//g)];
        if (!marks.length) return { other: src.trim() };
        const blocks = {};
        if (marks[0].index > 0) {
            const head = src.slice(0, marks[0].index).trim();
            if (head) blocks.other = head;
        }
        marks.forEach((m, i) => {
            const start = m.index + m[0].length;
            const end = i + 1 < marks.length ? marks[i + 1].index : src.length;
            blocks[m[1]] = src.slice(start, end).trim();
        });
        return blocks;
    }
    function buildActiveCss(theme, toggles) {
        const t = toggles || {};
        const blocks = theme.blocks || parseBlocks(theme.rawCss);
        return Object.entries(blocks).filter(([n]) => t[n] !== false)
            .map(([n, c]) => `/* block: ${n} */\n${c}`).join("\n\n");
    }
    function createTheme({ name, css, author = "me", tags = [], scope = "global", version = "1.0.0" }) {
        const id = `${String(name).trim().replace(/\s+/g, "-").toLowerCase() || "theme"}-${Date.now().toString(36)}`;
        const rawCss = String(css || "");
        return { id, name: String(name).trim() || "未命名主题", author, version,
            tags: Array.isArray(tags) ? tags : [], scope: scope || "global", kind: "css",
            rawCss, blocks: parseBlocks(rawCss), updatedAt: Date.now() };
    }
    function addTheme(t) { delete t.preview; S().themes[t.id] = t; saveSettingsDebounced(); return t; }

    const DEFAULT_NEW_CSS = `/* @theme-block: bubble */
.mes .mes_text { background: rgba(255,255,255,.06); border-radius: 14px; padding: 10px 14px; }
/* @theme-block: background */
#chat { background: linear-gradient(160deg, #1b1b2f, #16213e); }
/* @theme-block: other */
:root { --accent: #7bd88f; }
`;

    const TAVERN_DEFAULTS = {
        name: "", blur_strength: 10,
        main_text_color: "rgba(220,220,210,1)", italics_text_color: "rgba(188,231,207,1)",
        underline_text_color: "rgba(188,231,207,1)", quote_text_color: "rgba(225,138,36,1)",
        blur_tint_color: "rgba(23,26,33,1)", chat_tint_color: "rgba(23,26,33,1)",
        user_mes_blur_tint_color: "rgba(30,32,39,1)", bot_mes_blur_tint_color: "rgba(30,30,36,1)",
        shadow_color: "rgba(0,0,0,.5)", shadow_width: 2, border_color: "rgba(90,92,101,1)",
        font_scale: 1, fast_ui_mode: true, waifuMode: false, avatar_style: 0, chat_display: 1,
        noShadows: true, chat_width: 60, timer_enabled: true, timestamps_enabled: false,
        timestamp_date: false, mesIDDisplay_enabled: false, hideChatAvatars_enabled: false,
        message_token_count_enabled: false, expand_message_actions: false, enableZenSliders: false,
        enableLabMode: false, swipe_enabled: true, custom_css: "", bogus_folders: true,
        zoomed_avatar_magnification: false, reduced_motion: false, compact_input_area: true,
        show_swipe_num_all_messages: false,
    };
    function normalizeTavern(raw = {}) {
        const out = clone(TAVERN_DEFAULTS);
        for (const k of Object.keys(out)) if (raw[k] !== undefined) out[k] = raw[k];
        out.name = String(out.name ?? "").trim() || "未命名主题";
        if (typeof out.custom_css !== "string") out.custom_css = "";
        return out;
    }
    function isTavernTheme(o) {
        return !!(o && typeof o === "object" && typeof o.name === "string"
            && typeof o.main_text_color === "string" && typeof o.blur_tint_color === "string");
    }
    function tavernToCss(tv) {
        const colorMap = {
            main_text_color: "--SmartThemeBodyColor", italics_text_color: "--SmartThemeEmColor",
            underline_text_color: "--SmartThemeUnderlineColor", quote_text_color: "--SmartThemeQuoteColor",
            blur_tint_color: "--SmartThemeBlurTintColor", chat_tint_color: "--SmartThemeChatTintColor",
            user_mes_blur_tint_color: "--SmartThemeUserMesBlurTintColor",
            bot_mes_blur_tint_color: "--SmartThemeBotMesBlurTintColor",
            shadow_color: "--SmartThemeShadowColor", border_color: "--SmartThemeBorderColor",
        };
        const vars = Object.entries(colorMap).filter(([k]) => typeof tv[k] === "string" && tv[k].trim())
            .map(([k, v]) => `  ${v}: ${tv[k]} !important;`).join("\n");
        const layout = [];
        if (tv.noShadows) layout.push(".mes { box-shadow: none !important; }");
        if (tv.chat_display === 1) layout.push(".mes .mes_text { border-radius: 14px !important; }");
        if (tv.avatar_style === 1) layout.push(".avatar img { border-radius: 0 !important; }");
        if (tv.hideChatAvatars_enabled) layout.push(".mesAvatarWrapper { display: none !important; }");
        if (typeof tv.font_scale === "number" && tv.font_scale > 0)
            layout.push(`#chat { font-size: calc(1em * ${tv.font_scale}) !important; }`);
        if (typeof tv.chat_width === "number")
            layout.push(`#chat { width: ${tv.chat_width}% !important; max-width: 100% !important; }`);
        const parts = [`/* @theme-block: tavern-colors */\n:root {\n${vars}\n}`];
        if (layout.length) parts.push(`/* @theme-block: tavern-layout */\n${layout.join("\n")}`);
        const custom = String(tv.custom_css || "").trim();
        if (custom) parts.push(`/* @theme-block: tavern-custom */\n${custom}`);
        return parts.join("\n\n");
    }
    function createTavernTheme(rawTv) {
        const tavern = normalizeTavern(rawTv);
        const t = createTheme({ name: tavern.name, css: tavernToCss(tavern), author: "SillyTavern", tags: ["酒馆"], scope: "global" });
        t.kind = "tavern"; t.tavern = tavern; return t;
    }
    function themeToTavern(t) {
        if (t.kind === "tavern" && t.tavern) { const tv = normalizeTavern(t.tavern); tv.name = t.name; return tv; }
        const tv = normalizeTavern(); tv.name = t.name; tv.custom_css = String(t.rawCss || ""); return tv;
    }

    function applyTheme(theme) {
        const css = [buildActiveCss(theme, S().toggles[theme.id]),
            S().mobileFix[theme.id]?.enabled ? S().mobileFix[theme.id].css : ""].filter(Boolean).join("\n");
        let el = document.head.querySelector(`style[data-theme-id="${CSS.escape(theme.id)}"]`);
        if (!el) { el = document.createElement("style"); el.setAttribute("data-theme-id", theme.id); document.head.appendChild(el); }
        el.textContent = css;
    }
    function refreshAll() {
        document.head.querySelectorAll("style[data-theme-id]").forEach(el => {
            if (!S().activeIds.includes(el.getAttribute("data-theme-id"))) el.remove();
        });
        S().activeIds = S().activeIds.filter(id => S().themes[id]);
        const editing = ED.themeId && !$("#tm_edit").hasClass("tm-hidden");
        for (const id of S().activeIds) {
            if (editing && id === ED.themeId) continue;
            applyTheme(S().themes[id]);
        }
    }
    function setLivePreviewCss(css) {
        let el = document.getElementById("tm_live_preview");
        if (!el) { el = document.createElement("style"); el.id = "tm_live_preview"; document.head.appendChild(el); }
        el.textContent = String(css || "");
        if (ED.themeId) {
            try { document.head.querySelector(`style[data-theme-id="${CSS.escape(ED.themeId)}"]`)?.remove(); } catch {}
        }
    }
    function clearLivePreview() { document.getElementById("tm_live_preview")?.remove(); }

    function enableTheme(id) {
        const t = S().themes[id]; if (!t) return;
        if (t.kind === "tavern") {
            for (const oid of [...S().activeIds])
                if (oid !== id && S().themes[oid]?.kind === "tavern") disableTheme(oid);
        }
        if (!S().activeIds.includes(id)) S().activeIds.push(id);
        S().lastUsedAt[id] = Date.now();
        S().useCount[id] = (S().useCount[id] || 0) + 1;
        saveSettingsDebounced(); refreshAll();
    }
    function disableTheme(id) {
        S().activeIds = S().activeIds.filter(x => x !== id);
        saveSettingsDebounced(); refreshAll();
    }
    function deleteTheme(id) {
        const t = S().themes[id]; if (!t) return;
        if (!confirm(`删除主题「${t.name}」？不可恢复。`)) return;
        disableTheme(id);
        if (t.kind === "tavern" || (t.tags || []).includes("酒馆"))
            S().tavernDeleted = [...new Set([...(S().tavernDeleted || []), t.name])];
        delete S().themes[id];
        setPreview(id, "").catch(() => {});
        saveSettingsDebounced(); refreshAll(); renderList();
        toastr.success(`已删除「${t.name}」`);
    }
    function setBlockToggle(themeId, block, on) {
        (S().toggles[themeId] ||= {})[block] = on;
        saveSettingsDebounced(); refreshAll();
    }

    let tavernCache = null;
    async function fetchTavernThemeList({ force = false } = {}) {
        if (!force && tavernCache && Date.now() - tavernCache.at < 30000) return tavernCache.list;
        const headers = typeof window.__tm_getHeaders === "function"
            ? window.__tm_getHeaders() : { "Content-Type": "application/json" };
        const res = await fetch("/api/settings/get", { method: "POST", headers });
        if (!res.ok) throw new Error(`settings/get HTTP ${res.status}`);
        const data = await res.json();
        const list = Array.isArray(data?.themes) ? data.themes : [];
        tavernCache = { list, at: Date.now() };
        return list;
    }
    async function syncTavernThemes({ manual = false } = {}) {
        let list = [];
        try { list = await fetchTavernThemeList({ force: manual }); }
        catch (e) {
            console.warn("[美化管理] 拉取 themes 失败", e);
            if (manual) toastr.warning("无法读取酒馆主题列表");
            return [];
        }
        if (!list.length) { if (manual) toastr.warning("酒馆主题列表为空"); return []; }
        const existing = new Set(Object.values(S().themes).filter(t => t.kind === "tavern").map(t => t.name));
        const tomb = new Set(S().tavernDeleted || []);
        const added = [];
        for (const tv of list) {
            if (!tv || typeof tv !== "object") continue;
            const name = typeof tv.name === "string" ? tv.name.trim() : "";
            if (!name || existing.has(name) || tomb.has(name)) continue;
            const t = createTavernTheme({ ...tv, name });
            delete t.preview; addTheme(t); added.push(t.id);
        }
        if (added.length) { saveSettingsDebounced(); renderList(); }
        if (manual) toastr.info(added.length ? `已导入 ${added.length} 个酒馆主题` : "没有新的酒馆主题");
        return added;
    }

    function gradientPreviewDataUrl(css, w = 360, h = 240) {
        const cols = [...String(css).matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)/g)].map(m => m[0]).slice(0, 3);
        const c0 = cols[0] || "#2a2a40", c1 = cols[1] || "#3d5a80", c2 = cols[2] || c0;
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, c0); g.addColorStop(.55, c1); g.addColorStop(1, c2);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "rgba(255,255,255,.12)";
        ctx.fillRect(16, 20, w - 32, 36);
        ctx.fillRect(16, 68, (w - 32) * .7, 28);
        ctx.fillRect(16, 108, (w - 32) * .85, 28);
        return cv.toDataURL("image/png");
    }
    function ensureThumb(t) {
        let pv = getPreviewSync(t.id);
        if (pv) return pv;
        try {
            pv = gradientPreviewDataUrl(t.rawCss || "", 360, 240);
            if (pv) { previewMem.set(t.id, pv); setPreview(t.id, pv).catch(() => {}); }
        } catch { pv = ""; }
        return pv;
    }

    const MOBILE_RULES = [
        { re: /(?:^|[;\s])(?:width|height)\s*:\s*(\d{4,})px/g, lv: "❌", hint: m => `固定 ${m[1]}px 可能超出手机视口` },
        { re: /min-width\s*:\s*([5-9]\d{2,})px/g, lv: "❌", hint: m => `min-width:${m[1]}px 易撑破视口` },
        { re: /padding\s*:\s*(\d{3,})px/g, lv: "⚠️", hint: m => `padding:${m[1]}px 过大` },
        { re: /position\s*:\s*fixed/g, lv: "⚠️", hint: () => "position:fixed 可能遮挡输入区" },
    ];
    function auditMobile(css) {
        const issues = [];
        for (const r of MOBILE_RULES) {
            r.re.lastIndex = 0; let m;
            while ((m = r.re.exec(css))) issues.push(`L${css.slice(0, m.index).split("\n").length} ${r.lv} ${r.hint(m)}`);
        }
        css.split("\n").forEach((l, i) => {
            if (/:(hover)\b/.test(l) && !/@media/.test(l)) issues.push(`L${i + 1} ℹ️ :hover 在触屏无效`);
        });
        return issues.length ? issues : ["✅ 未发现明显移动端问题"];
    }
    function buildMobileFix() {
        return "/* auto mobile-fix */\n@media (max-width:425px){\n  #chat,.mes,.mes_block,.mes_text,#send_form,#form_sheld{min-width:0!important;max-width:100%!important}\n  .mes{padding:8px!important}\n}";
    }

    const CHAT_BASE = [
        ["char", "<em>（擦拭杯子，微笑）</em>欢迎光临旅店，旅人。<q>「第一杯蜂蜜酒算我请的。」</q>", "Seraphina"],
        ["user", "（推开门，抖落肩上的雪）路上遇到暴风雪了。"],
        ["char", "哎呀，瞧你一身雪。快到壁炉边坐。<u>壁炉旁很暖和。</u>", "Seraphina"],
        ["user", "多谢。这里比传闻中还热闹。"],
        ["char", "<strong>旁白：</strong>吟游诗人刚讲了个龙的笑话。<em>（她眨了眨眼）</em>", "Seraphina"],
        ["user", "我最喜欢龙的笑话。"],
        ["char", "龙走进旅店，所有人都跑光了——因为它挤不进门！😄", "Seraphina"],
        ["user", "（喷出一口酒）哈哈哈这也太冷了！"],
        ["char", "那接下来想听什么？冒险故事，还是……你自己的故事？", "Seraphina"],
        ["user", "我的故事？不过是个满身风雪的旅人罢了。"],
        ["char", "<em>（递过热杯）</em>每个人都有故事。喝完这杯再上路不迟。", "Seraphina"],
        ["user", "好。再给我讲一个吧。"],
        ["char", "从前有个旅人，以为风雪是终点，结果推开了旅店的门。", "Seraphina"],
        ["user", "……你这是在说我？"],
        ["char", "<q>「也许。」</q>她笑了笑。", "Seraphina"],
        ["user", "那我就当这是个好兆头。"],
        ["char", "壁炉里的木柴噼啪作响，像在鼓掌。", "Seraphina"],
        ["user", "今天能在这里落脚，真幸运。"],
        ["char", "旅店的门，永远为风雪中的人开着。", "Seraphina"],
        ["user", "我会记住的。"],
    ];
    const AV = (ch, color) => "data:image/svg+xml," + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${color}"/><text x="48" y="60" font-size="34" text-anchor="middle" fill="#fff" font-family="sans-serif">${ch}</text></svg>`);
    const AV_CHAR = AV("S", "#5b6ee1");
    const AV_USER = AV("你", "#3f78bc");

    const SANDBOX_CSS = `
*{box-sizing:border-box} html,body{height:100%;margin:0}
body{
  display:flex;flex-direction:column;
  font:15px/1.65 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;
  background:var(--SmartThemeBlurTintColor,#12121a);
  color:var(--SmartThemeBodyColor,#e8e8f0);
  overflow:hidden;
}
#top-bar{
  flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;
  padding:8px 12px;border-bottom:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.12));
  font-size:13px;opacity:.9;
}
#sheld{flex:1;display:flex;flex-direction:column;min-height:0;width:100%}
#chat{flex:1;overflow-y:auto;padding:10px 12px;min-height:0}
.mes{display:flex;gap:10px;margin:12px 0;align-items:flex-start}
.mes.is_user{flex-direction:row-reverse}
.avatar{width:42px;height:42px;border-radius:50%;overflow:hidden;flex:0 0 auto}
.avatar img{width:100%;height:100%;object-fit:cover;display:block}
.mes_block{max-width:min(92%,520px);min-width:0}
.ch_name{font-size:12px;opacity:.7;margin-bottom:4px}
.mes_text{
  padding:9px 12px;border-radius:14px;white-space:pre-wrap;word-break:break-word;
  background:var(--SmartThemeBotMesBlurTintColor,rgba(255,255,255,.06));
  border:1px solid var(--SmartThemeBorderColor,transparent);
  color:var(--SmartThemeBodyColor,inherit);
}
.mes.is_user .mes_text{background:var(--SmartThemeUserMesBlurTintColor,rgba(255,255,255,.1))}
.mes_text em{color:var(--SmartThemeEmColor,#b8e0c8);font-style:italic}
.mes_text u{color:var(--SmartThemeUnderlineColor,#b8e0c8);text-decoration:underline}
.mes_text q{color:var(--SmartThemeQuoteColor,#e0a86a)}
.mes_text strong{font-weight:700}
#form_sheld{
  flex:0 0 auto;border-top:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.12));
  padding:10px 12px;
  background:color-mix(in srgb,var(--SmartThemeBlurTintColor,#12121a) 90%,#000);
}
#send_form{display:flex;gap:8px;align-items:flex-end}
#send_textarea{
  flex:1;min-height:38px;max-height:90px;resize:none;padding:8px 12px;border-radius:12px;
  border:1px solid var(--SmartThemeBorderColor,rgba(255,255,255,.15));
  background:rgba(255,255,255,.06);color:inherit;font:inherit;outline:none;
}
#send_but{
  width:40px;height:40px;border-radius:50%;display:grid;place-items:center;
  background:var(--SmartThemeQuoteColor,#5b6ee1);color:#fff;font-size:15px;
}
.tm-hint{text-align:center;font-size:11px;opacity:.4;padding:8px}
`;

    function buildSandboxHTML({ msgCount = 3, themeCss = "" } = {}) {
        const n = Math.max(1, Math.min(20, Number(msgCount) || 3));
        const msgs = [];
        for (let i = 0; i < n; i++) {
            const [who, body, name] = CHAT_BASE[i % CHAT_BASE.length];
            const isUser = who === "user";
            msgs.push(`<div class="mes ${isUser ? "is_user" : ""}">
  <div class="avatar"><img src="${isUser ? AV_USER : AV_CHAR}" alt=""></div>
  <div class="mes_block">
    <div class="ch_name">${isUser ? "你" : (name || "Seraphina")}</div>
    <div class="mes_text">${body}</div>
  </div>
</div>`);
        }
        const safe = String(themeCss).replace(/<\/(style|script)/gi, "<\\/$1");
        return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${SANDBOX_CSS}</style>
<style id="tm-preview-style">${safe}</style>
</head>
<body>
<div id="top-bar"><span>SillyTavern · 沙盒预览</span><span>iframe</span></div>
<div id="sheld">
  <div id="chat">
    ${msgs.join("\n")}
    <div class="tm-hint">— ${n} 条示例 · 实时 CSS · 不截图 —</div>
  </div>
  <div id="form_sheld">
    <div id="send_form">
      <textarea id="send_textarea" rows="1" placeholder="在此输入消息…" readonly></textarea>
      <div id="send_but">➤</div>
    </div>
  </div>
</div>
</body></html>`;
    }

    /** M2 预览系统：iframe 沙盒实时预览 */
    const DEVICES = {
        mobile:    { w: 390,  h: 720, label: "手机" },
        landscape: { w: 844,  h: 390, label: "横屏" },
        tablet:    { w: 768,  h: 900, label: "平板" },
        pc:        { w: 1920, h: 940, label: "PC" },
    };

    class PreviewManager {
        constructor($root) {
            this.$root = $root;
            this.css = "";
            this.device = "mobile";
            this.msgCount = 3;
            this._built = false;
        }
        mount() {
            if (this._built) return;
            this._built = true;
            const devBtns = Object.entries(DEVICES).map(([k, d]) =>
                `<button type="button" class="menu_button tm-dev ${k === "mobile" ? "tm-on" : ""}" data-dev="${k}" title="${d.w}×${d.h}">${d.label}</button>`
            ).join("");
            this.$root.html(`
              <div class="tm-prev-bar">
                <div class="tm-prev-devices">${devBtns}</div>
                <div class="tm-prev-right">
                  <select class="tm-msg-count" title="聊天长度">
                    <option value="3">3 条</option>
                    <option value="20">20 条</option>
                  </select>
                  <button type="button" class="menu_button tm-refresh" title="手动刷新">🔄</button>
                </div>
              </div>
              <div class="tm-prev-stage">
                <div class="tm-prev-framebox">
                  <iframe class="tm-prev-frame" sandbox="allow-same-origin" title="主题预览"></iframe>
                </div>
              </div>`);
            this.$frame = this.$root.find(".tm-prev-frame");
            this.$box = this.$root.find(".tm-prev-framebox");
            this.$stage = this.$root.find(".tm-prev-stage");
            this.$root.on("click", ".tm-dev", e => {
                this.device = $(e.currentTarget).data("dev");
                this.$root.find(".tm-dev").removeClass("tm-on");
                $(e.currentTarget).addClass("tm-on");
                this.relayout();
            });
            this.$root.on("change", ".tm-msg-count", e => {
                this.msgCount = Number(e.target.value) || 3;
                this.rebuild();
            });
            this.$root.on("click", ".tm-refresh", () => this.rebuild());
            $(window).on("resize.tm_prev", () => this.relayout());
            this.rebuild();
        }
        setCss(css) {
            this.css = String(css || "");
            const el = this.$frame?.[0]?.contentDocument?.getElementById("tm-preview-style");
            if (el) el.textContent = this.css;
            else this.rebuild();
        }
        rebuild() {
            const frame = this.$frame?.[0];
            if (!frame) return;
            frame.onload = () => {
                this.setCss(this.css);
                this.relayout();
            };
            frame.srcdoc = buildSandboxHTML({ msgCount: this.msgCount, themeCss: this.css });
        }
        relayout() {
            if (!this.$frame?.length) return;
            const d = DEVICES[this.device] || DEVICES.mobile;
            const avail = Math.max(160, (this.$stage.width() || 360) - 16);
            const s = Math.min(1, avail / d.w);
            this.$frame.css({ width: d.w, height: d.h, transform: `scale(${s})` });
            this.$box.css({ width: Math.floor(d.w * s), height: Math.floor(d.h * s) });
        }
        destroy() {
            $(window).off("resize.tm_prev");
        }
    }

    const CM_VER = "5.65.18";
    const CM_BASES = [`https://cdn.jsdelivr.net/npm/codemirror@${CM_VER}`, `https://fastly.jsdelivr.net/npm/codemirror@${CM_VER}`];
    function loadScript(url) {
        return new Promise((resolve, reject) => {
            const s = document.createElement("script"); s.src = url; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
        });
    }
    function loadCss(url) {
        return new Promise(resolve => {
            const l = document.createElement("link"); l.rel = "stylesheet"; l.href = url; l.onload = resolve; l.onerror = resolve; document.head.appendChild(l);
        });
    }
    async function createEditor(container, { value = "", onChange, onSave } = {}) {
        container.innerHTML = "";
        try {
            let base = null;
            for (const b of CM_BASES) {
                try {
                    await loadCss(`${b}/lib/codemirror.css`);
                    await loadScript(`${b}/lib/codemirror.js`);
                    if (window.CodeMirror) { base = b; break; }
                } catch {}
            }
            if (!base || !window.CodeMirror) throw new Error("CM unavailable");
            await loadScript(`${base}/mode/css/css.js`).catch(() => {});
            const cm = window.CodeMirror(container, {
                value: value || "", mode: "css", lineNumbers: true, lineWrapping: true, indentUnit: 2, tabSize: 2,
                extraKeys: { "Ctrl-S": () => onSave?.(), "Cmd-S": () => onSave?.() },
            });
            cm.on("change", () => onChange?.(cm.getValue()));
            return { getValue: () => cm.getValue(), setValue: v => cm.setValue(v || ""), focus: () => cm.focus(), refresh: () => cm.refresh() };
        } catch (e) {
            console.warn("[美化管理] CodeMirror 降级", e);
            const ta = document.createElement("textarea");
            ta.className = "tm-plain-editor"; ta.value = value || ""; ta.spellcheck = false;
            container.appendChild(ta);
            ta.addEventListener("input", () => onChange?.(ta.value));
            return { getValue: () => ta.value, setValue: v => { ta.value = v || ""; }, focus: () => ta.focus(), refresh: () => {} };
        }
    }

    function relTime(ts) {
        const d = Date.now() - Number(ts || 0);
        if (d < 6e4) return "刚刚";
        if (d < 36e5) return `${Math.floor(d / 6e4)} 分钟前`;
        if (d < 864e5) return `${Math.floor(d / 36e5)} 小时前`;
        return `${Math.floor(d / 864e5)} 天前`;
    }
    function visibleThemes() {
        let arr = Object.values(S().themes);
        const q = S().search.trim().toLowerCase();
        if (q) arr = arr.filter(t => `${t.name} ${t.author} ${(t.tags || []).join(" ")}`.toLowerCase().includes(q));
        if (S().tagFilter) arr = arr.filter(t => (t.tags || []).includes(S().tagFilter));
        if (S().favOnly) arr = arr.filter(t => S().favorites.includes(t.id));
        const sorters = {
            updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
            used: (a, b) => (S().lastUsedAt[b.id] || 0) - (S().lastUsedAt[a.id] || 0),
            uses: (a, b) => (S().useCount[b.id] || 0) - (S().useCount[a.id] || 0),
            name: (a, b) => String(a.name).localeCompare(String(b.name), "zh"),
        };
        return arr.sort(sorters[S().sortBy] || sorters.updated);
    }
    function cardHtml(t) {
        if (!t?.id) return "";
        const active = S().activeIds.includes(t.id), fav = S().favorites.includes(t.id);
        const raw = String(t.rawCss || "");
        const kb = (new Blob([raw]).size / 1024).toFixed(1);
        const tog = S().toggles[t.id] || {};
        const scopeName = t.kind === "tavern" ? "酒馆原生" : ({ global: "全局", character: "角色", chat: "聊天" }[t.scope] || "全局");
        const pv = ensureThumb(t);
        const blocks = Object.keys(t.blocks || {});
        const blockChecks = blocks.map(n => {
            const on = tog[n] !== false;
            return `<label><input type="checkbox" data-block="${esc(n)}" ${on ? "checked" : ""}> ${esc(n)}</label>`;
        }).join("");
        return `<div class="tm-card ${active?"tm-active":""}" data-theme="${esc(t.id)}">
          <div class="tm-thumb">${pv?`<img src="${pv}" alt="">`:`<span class="tm-thumb-none">无预览</span>`}
            <span class="tm-badge">${scopeName}</span>${active?`<span class="tm-badge tm-badge-on">使用中</span>`:""}
            <button type="button" class="tm-fav ${fav?"tm-on":""}" title="收藏">★</button></div>
          <div class="tm-card-main">
            <div class="tm-title">${esc(t.name)}</div>
            <div class="tm-meta">${esc(t.author)} · ${kb}KB · ${relTime(t.updatedAt)} · ${S().useCount[t.id]||0} 次</div>
            <div class="tm-tags">${(t.tags||[]).map(x=>`<span class="tm-chip">#${esc(x)}</span>`).join("")}</div>
            <div class="tm-blocks">${blockChecks}</div>
            <div class="tm-actions">
              <button type="button" class="menu_button tm-toggle">${active?"停用":"应用"}</button>
              <button type="button" class="menu_button tm-edit">编辑</button>
              <button type="button" class="menu_button tm-del">删除</button>
              <button type="button" class="menu_button tm-more" title="更多">…</button>
              <div class="tm-menu tm-hidden"></div>
            </div></div></div>`;
    }
    function renderTags() {
        const tags = [...new Set(Object.values(S().themes).flatMap(t => t.tags || []))].sort();
        $("#tm_tags").empty().append(tags.map(tag =>
            `<button type="button" class="tm-chip ${S().tagFilter===tag?"tm-on":""}" data-tag="${esc(tag)}">#${esc(tag)}</button>`).join(""));
    }
    function renderQuickSwitch() {
        const $q = $("#tm_quick").empty().append(`<option value="">快速切换…</option>`);
        const arr = Object.values(S().themes).sort((a,b)=>(S().lastUsedAt[b.id]||b.updatedAt||0)-(S().lastUsedAt[a.id]||a.updatedAt||0));
        for (const t of arr) $q.append(`<option value="${esc(t.id)}">${esc(t.name)}${S().activeIds.includes(t.id)?" ●":""}</option>`);
    }
    function renderList() {
        renderTags();
        $("#tm_view").text(S().viewMode === "grid" ? "▦" : "☰");
        $("#tm_fav_filter").toggleClass("tm-on", !!S().favOnly);
        const $list = $("#tm_list").attr("data-view", S().viewMode);
        const st = $list.scrollTop(); $list.empty();
        const arr = visibleThemes();
        if (!arr.length) $list.append('<div class="tm-empty">没有主题。可「新建」或「同步酒馆」。</div>');
        else for (const t of arr) $list.append(cardHtml(t));
        $list.scrollTop(st); renderQuickSwitch();
        Promise.all(arr.map(async t => {
            if (getPreviewSync(t.id)) return false;
            return !!(await hydratePreview(t.id));
        })).then(flags => { if (flags.some(Boolean)) renderList(); });
    }
    function toggleMoreMenu($btn) {
        const $card = $btn.closest(".tm-card");
        let $menu = $card.find(".tm-menu");
        if (!$menu.length) { $menu = $('<div class="tm-menu tm-hidden"></div>'); $card.find(".tm-actions").append($menu); }
        if (!$menu.hasClass("tm-hidden")) { $menu.addClass("tm-hidden"); return; }
        $(".tm-menu").addClass("tm-hidden");
        const id = String($card.data("theme") || "");
        const t = S().themes[id]; if (!t) return;
        const hasFix = !!S().mobileFix[id];
        $menu.html(`
          <button type="button" class="tm-mi" data-act="export">导出（酒馆格式）</button>
          <button type="button" class="tm-mi" data-act="exportExt">导出（扩展格式）</button>
          <button type="button" class="tm-mi" data-act="pvgen">生成预览图</button>
          <button type="button" class="tm-mi" data-act="pvd">删除预览图</button>
          <button type="button" class="tm-mi" data-act="dup">复制一份</button>
          <button type="button" class="tm-mi" data-act="audit">移动端体检</button>
          <button type="button" class="tm-mi" data-act="fix">${hasFix?"重建移动修复":"一键移动修复"}</button>
          ${hasFix?`<button type="button" class="tm-mi" data-act="fixdel">删除移动修复</button>`:""}
          <button type="button" class="tm-mi tm-danger" data-act="del">删除主题</button>`).removeClass("tm-hidden");
    }
    function showReport(title, lines) {
        $("#tm_report").remove();
        $("body").append(`<div id="tm_report"><div class="tm-report"><div class="tm-report-head"><b>${esc(title)}</b>
          <button type="button" class="menu_button tm-report-close">✕</button></div>
          <pre>${lines.map(esc).join("\n")}</pre></div></div>`);
        $("#tm_report").on("click", e => { if (e.target.id === "tm_report") $("#tm_report").remove(); });
        $(".tm-report-close").on("click", () => $("#tm_report").remove());
    }

    async function openEditor(themeId) {
        try {
            if (ED.dirty && !confirm("有未保存改动，仍要切换？")) return;
            const id = String(themeId || "");
            const t = S().themes[id];
            if (!t) { toastr?.error?.("主题不存在"); return; }
            ED.themeId = id;
            $("#tm_edit_name").val(t.name || "");
            $("#tm_panel").addClass("tm-hidden");
            $("#tm_edit").removeClass("tm-hidden");
            if (!ED.built || !ED.editor) {
                ED.built = true;
                ED.editor = await createEditor($("#tm_edit_code")[0], {
                    value: "",
                    onChange: v => {
                        ED.dirty = true;
                        clearTimeout(ED.liveTimer);
                        ED.liveTimer = setTimeout(() => {
                            ED.preview?.setCss(v);
                            setLivePreviewCss(v);
                        }, 280);
                    },
                    onSave: () => saveEditor(),
                });
                ED.preview = new PreviewManager($("#tm_edit_prev"));
                ED.preview.mount();
            }
            const css = String(t.rawCss || "");
            ED.editor.setValue(css);
            ED.dirty = false;
            ED.preview.css = css;
            ED.preview.rebuild();
            setLivePreviewCss(css);
            refreshAll();
            requestAnimationFrame(() => {
                try { ED.editor.refresh(); } catch { /* */ }
                try { ED.preview?.relayout(); } catch { /* */ }
            });
            ED.editor.focus();
        } catch (e) {
            console.error("[美化管理] openEditor", e);
            toastr?.error?.("打开编辑失败：" + (e.message || e));
        }
    }
    function closeEditor() {
        if (ED.dirty && !confirm("有未保存改动，仍要离开？")) return;
        clearLivePreview(); ED.themeId = null; ED.dirty = false;
        $("#tm_edit").addClass("tm-hidden"); $("#tm_panel").removeClass("tm-hidden");
        refreshAll(); renderList();
    }
    function saveEditor() {
        const t = S().themes[ED.themeId]; if (!t || !ED.editor) return;
        const css = ED.editor.getValue();
        if (t.kind === "tavern" && css !== t.rawCss) { t.kind = "css"; delete t.tavern; toastr?.info?.("已转为 CSS 主题"); }
        t.rawCss = css; t.blocks = parseBlocks(css);
        t.name = $("#tm_edit_name").val().trim() || t.name;
        if (t.kind === "tavern" && t.tavern) t.tavern.name = t.name;
        t.updatedAt = Date.now();
        const tog = S().toggles[t.id] || {};
        for (const k of Object.keys(tog)) if (!(k in t.blocks)) delete tog[k];
        delete t.preview; saveSettingsDebounced();
        setLivePreviewCss(css); refreshAll(); ED.dirty = false;
        try { setPreview(t.id, gradientPreviewDataUrl(css, 360, 240)).then(() => renderList()); } catch {}
        toastr?.success?.("已保存");
    }

    const safeFileName = s => String(s).trim().replace(/[\\/:*?"<>|]/g, "_") || "theme";
    function downloadJson(filename, data) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
        Object.assign(document.createElement("a"), { href: url, download: filename }).click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    function exportTheme(id, asTavern = true) {
        const t = S().themes[id]; if (!t) return;
        if (asTavern) downloadJson(`${safeFileName(t.name)}.json`, themeToTavern(t));
        else downloadJson(`${safeFileName(t.name)}.theme.json`, { name: t.name, author: t.author, version: t.version, tags: t.tags, scope: t.scope, kind: t.kind, css: t.rawCss });
        toastr?.success?.("已导出");
    }
    async function importFromFile(file) {
        let o;
        try { o = JSON.parse(await file.text()); }
        catch { return toastr?.error?.(`${file.name} 不是合法 JSON`); }
        try {
            let t;
            if (isTavernTheme(o)) { t = createTavernTheme(o); toastr?.success?.(`已导入酒馆主题：${t.name}`); }
            else if (o?.name && typeof o.css === "string") {
                t = createTheme({ name: o.name, css: o.css, author: o.author || "unknown",
                    tags: Array.isArray(o.tags) ? o.tags : [], scope: o.scope || "global", version: o.version || "1.0.0" });
                toastr?.success?.(`已导入：${t.name}`);
            } else throw new Error("无法识别的格式");
            if (t.kind === "tavern") S().tavernDeleted = (S().tavernDeleted || []).filter(n => n !== t.name);
            delete t.preview; addTheme(t); ensureThumb(t); renderList();
        } catch (e) { toastr?.error?.(`导入失败：${e.message}`); }
    }

    function addMenuEntry() {
        if ($("#tm_menu_entry").length) return;
        $("<div>", { id: "tm_menu_entry", class: "list-group-item flex-container flexGap5" })
            .append($("<div>", { class: "fa-solid fa-palette extensionsMenuExtensionButton", title: "美化管理" }))
            .append($("<span>", { text: "美化管理" }))
            .on("click", () => $("#tm_panel").toggleClass("tm-hidden"))
            .appendTo("#extensionsMenu");
    }
    function buildPanel() {
        if ($("#tm_panel").length) return;
        $("body").append(`
        <div id="tm_panel" class="tm-hidden">
          <div class="tm-head"><b>🎨 美化管理</b>
            <span class="tm-head-btns">
              <select id="tm_quick" title="快速切换"></select>
              <button type="button" id="tm_new" class="menu_button">新建</button>
              <button type="button" id="tm_import" class="menu_button">导入</button>
              <input id="tm_file" type="file" accept=".json,application/json" hidden>
              <button type="button" id="tm_sync" class="menu_button" title="从酒馆导入主题">同步酒馆</button>
              <button type="button" id="tm_disable_all" class="menu_button" title="全部关闭">原版</button>
              <button type="button" id="tm_close" class="menu_button">✕</button>
            </span></div>
          <div class="tm-toolbar">
            <input id="tm_search" class="text_pole" placeholder="搜名称 / 作者 / 标签…">
            <select id="tm_sort">
              <option value="updated">最近更新</option><option value="used">最近使用</option>
              <option value="uses">使用次数</option><option value="name">名称</option>
            </select>
            <button type="button" id="tm_fav_filter" class="menu_button" title="只看收藏">★</button>
            <button type="button" id="tm_view" class="menu_button" title="网格/列表">▦</button>
          </div>
          <div id="tm_tags"></div>
          <div id="tm_list" data-view="grid"></div>
        </div>
        <div id="tm_edit" class="tm-hidden">
          <div class="tm-edit-head">
            <button type="button" id="tm_edit_back" class="menu_button">← 返回</button>
            <input id="tm_edit_name" class="text_pole" placeholder="主题名称">
            <span class="tm-edit-info">左代码 · 右 iframe 沙盒实时预览（≈300ms）· Ctrl+S 保存 · Esc 返回</span>
            <button type="button" id="tm_edit_save" class="menu_button">保存</button>
          </div>
          <div class="tm-edit-body">
            <div id="tm_edit_code"></div>
            <div id="tm_edit_prev" class="tm-preview"></div>
          </div>
        </div>`);

        $("#tm_close").on("click", () => $("#tm_panel").addClass("tm-hidden"));
        $("#tm_new").on("click", () => {
            const t = addTheme(createTheme({ name: "未命名主题", css: DEFAULT_NEW_CSS }));
            ensureThumb(t); renderList(); openEditor(t.id);
        });
        $("#tm_import").on("click", () => $("#tm_file").trigger("click"));
        $("#tm_file").on("change", e => { [...e.target.files].forEach(importFromFile); e.target.value = ""; });
        $("#tm_sync").on("click", async () => { await syncTavernThemes({ manual: true }); });
        $("#tm_disable_all").on("click", () => { [...S().activeIds].forEach(id => disableTheme(id)); renderList(); });
        let st;
        $("#tm_search").on("input", function () { clearTimeout(st); const v = this.value; st = setTimeout(() => { S().search = v; renderList(); }, 200); });
        $("#tm_sort").on("change", function () { S().sortBy = this.value; saveSettingsDebounced(); renderList(); });
        $("#tm_fav_filter").on("click", () => { S().favOnly = !S().favOnly; saveSettingsDebounced(); renderList(); });
        $("#tm_view").on("click", () => { S().viewMode = S().viewMode === "grid" ? "list" : "grid"; saveSettingsDebounced(); renderList(); });
        $("#tm_quick").on("change", function () {
            const id = this.value; this.selectedIndex = 0; if (!id) return;
            [...S().activeIds].forEach(x => x !== id && disableTheme(x)); enableTheme(id); renderList();
        });
        $("#tm_tags").on("click", ".tm-chip", function () {
            const tag = $(this).data("tag"); S().tagFilter = S().tagFilter === tag ? "" : tag; renderList();
        });
        $("#tm_edit_back").on("click", closeEditor);
        $("#tm_edit_save").on("click", saveEditor);

        $("#tm_panel")
            .on("click", ".tm-toggle", function (e) {
                e.preventDefault(); e.stopPropagation();
                const id = String($(this).closest(".tm-card").data("theme") || ""); if (!id) return;
                S().activeIds.includes(id) ? disableTheme(id) : enableTheme(id); renderList();
            })
            .on("click", ".tm-edit", function (e) {
                e.preventDefault(); e.stopPropagation();
                const id = String($(this).closest(".tm-card").data("theme") || ""); if (id) openEditor(id);
            })
            .on("click", ".tm-del", function (e) {
                e.preventDefault(); e.stopPropagation();
                const id = String($(this).closest(".tm-card").data("theme") || ""); if (id) deleteTheme(id);
            })
            .on("click", ".tm-more", function (e) {
                e.preventDefault(); e.stopPropagation(); toggleMoreMenu($(this));
            })
            .on("click", ".tm-fav", function (e) {
                e.preventDefault(); e.stopPropagation();
                const id = String($(this).closest(".tm-card").data("theme") || ""); if (!id) return;
                S().favorites = S().favorites.includes(id) ? S().favorites.filter(x => x !== id) : [...S().favorites, id];
                saveSettingsDebounced(); renderList();
            })
            .on("change", ".tm-blocks input[data-block]", function (e) {
                e.stopPropagation();
                const id = String($(this).closest(".tm-card").data("theme") || "");
                const block = $(this).data("block");
                if (id && block) setBlockToggle(id, block, !!this.checked);
            })
            .on("click", ".tm-mi", function (e) {
                e.preventDefault(); e.stopPropagation();
                const id = String($(this).closest(".tm-card").data("theme") || "");
                const act = $(this).data("act"); const t = S().themes[id];
                $(".tm-menu").addClass("tm-hidden"); if (!t) return;
                switch (act) {
                    case "export": exportTheme(id, true); break;
                    case "exportExt": exportTheme(id, false); break;
                    case "pvgen": {
                        const pv = gradientPreviewDataUrl(buildActiveCss(t, S().toggles[id]) || t.rawCss, 360, 240);
                        setPreview(id, pv).then(() => { renderList(); toastr?.success?.("预览图已生成"); });
                        break;
                    }
                    case "pvd":
                        setPreview(id, "").then(() => { renderList(); toastr?.info?.("预览图已删除"); });
                        break;
                    case "dup": {
                        const n = createTheme({ name: t.name + " 副本", css: t.rawCss, author: t.author, tags: [...(t.tags||[])], scope: t.scope });
                        addTheme(n); ensureThumb(n); renderList(); break;
                    }
                    case "audit": showReport(`移动端体检 · ${t.name}`, auditMobile(buildActiveCss(t, S().toggles[id]))); break;
                    case "fix":
                        S().mobileFix[id] = { enabled: true, css: buildMobileFix() };
                        saveSettingsDebounced(); refreshAll(); toastr?.success?.("已生成 mobile-fix"); break;
                    case "fixdel":
                        delete S().mobileFix[id]; saveSettingsDebounced(); refreshAll(); toastr?.info?.("已删除移动修复层"); break;
                    case "del": deleteTheme(id); break;
                }
            });

        $(document).on("click.tm_menu", e => {
            if ($(e.target).closest(".tm-more, .tm-menu").length) return;
            $(".tm-menu").addClass("tm-hidden");
        });
        document.addEventListener("keydown", e => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !$("#tm_edit").hasClass("tm-hidden")) {
                e.preventDefault(); saveEditor();
            } else if (e.key === "Escape" && !$("#tm_edit").hasClass("tm-hidden")) closeEditor();
            else if (e.ctrlKey && e.shiftKey && e.code === "KeyB") { e.preventDefault(); $("#tm_panel").toggleClass("tm-hidden"); }
        });
    }

    function boot() {
        loadSettings(); addMenuEntry(); buildPanel();
        $("#tm_sort").val(S().sortBy || "updated");
        renderList(); refreshAll();
        if (event_types?.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, () => refreshAll());
        (async () => {
            try {
                const ids = await syncTavernThemes({ manual: false });
                if (ids.length) console.info(`[美化管理] 自动导入酒馆主题 ${ids.length} 个`);
                renderList();
            } catch (e) { console.warn("[美化管理] 启动同步失败", e); }
        })();
        console.info("[美化管理] v0.7.1 已启动");
    }

    if (event_types?.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        setTimeout(() => { if (!$("#tm_panel").length) boot(); }, 1500);
    } else {
        jQuery(boot);
    }
})();
