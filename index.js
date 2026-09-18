/**
 * 美化管理 Theme Manager v0.7.4
 * 真实页面实时预览 + 光标/点击双向定位 + 酒馆同步/应用修复
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
    const ED = { themeId: null, editor: null, built: false, dirty: false, liveTimer: null };
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
        const parts = [`/* @theme-block: tavern-colors */\n:root, html, body {\n${vars}\n}`];
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

    function ensureStyleTag(id) {
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement("style");
            el.id = id;
            (document.body || document.head).appendChild(el);
        } else if (document.body && el.parentElement !== document.body) {
            document.body.appendChild(el);
        }
        return el;
    }
    function applyTheme(theme) {
        if (!theme) return;
        const css = [
            buildActiveCss(theme, S().toggles[theme.id]),
            S().mobileFix[theme.id]?.enabled ? S().mobileFix[theme.id].css : "",
        ].filter(Boolean).join("\n");
        let el = document.querySelector(`style[data-theme-id="${CSS.escape(theme.id)}"]`);
        if (!el) {
            el = document.createElement("style");
            el.setAttribute("data-theme-id", theme.id);
            (document.body || document.head).appendChild(el);
        }
        el.textContent = css;
        if (document.body) document.body.appendChild(el);
    }
    function refreshAll() {
        document.querySelectorAll("style[data-theme-id]").forEach(el => {
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
        const el = ensureStyleTag("tm_live_preview");
        el.textContent = String(css || "");
        if (ED.themeId) {
            try { document.querySelector(`style[data-theme-id="${CSS.escape(ED.themeId)}"]`)?.remove(); } catch {}
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
        saveSettingsDebounced();
        refreshAll();
        try { if (power_user && t.name) power_user.theme = t.name; } catch {}
        try {
            const el = document.querySelector(`style[data-theme-id="${CSS.escape(id)}"]`);
            if (el && document.body) document.body.appendChild(el);
        } catch {}
        toastr?.success?.(`已应用「${t.name}」（扩展层覆盖页面样式）`);
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
        let list = [];
        try {
            const res = await fetch("/api/settings/get", { method: "POST", headers });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data?.themes)) list = data.themes;
                else if (Array.isArray(data?.settings?.themes)) list = data.settings.themes;
                else if (Array.isArray(data?.power_user?.themes)) list = data.power_user.themes;
            }
        } catch (e) { console.warn("[美化管理] settings/get 失败", e); }
        if (!list.length) {
            try {
                if (Array.isArray(power_user?.themes)) list = power_user.themes;
                else if (power_user?.themes && typeof power_user.themes === "object")
                    list = Object.values(power_user.themes);
            } catch {}
        }
        tavernCache = { list: list || [], at: Date.now() };
        return tavernCache.list;
    }
    async function syncTavernThemes({ manual = false } = {}) {
        let list = [];
        try { list = await fetchTavernThemeList({ force: manual }); }
        catch (e) {
            console.warn("[美化管理] 拉取 themes 失败", e);
            if (manual) toastr.warning("无法读取酒馆主题列表");
            return [];
        }
        const existing = new Set(Object.values(S().themes).filter(t => t.kind === "tavern").map(t => t.name));
        const tomb = new Set(S().tavernDeleted || []);
        const added = [];
        for (const tv of list) {
            if (!tv || typeof tv !== "object") continue;
            const name = typeof tv.name === "string" ? tv.name.trim() : "";
            if (!name || existing.has(name) || tomb.has(name)) continue;
            if (!isTavernTheme({ ...tv, name }) && typeof tv.custom_css !== "string") continue;
            const t = createTavernTheme({ ...tv, name });
            delete t.preview; addTheme(t); added.push(t.id);
        }
        if (manual) {
            let liveCss = "";
            try { liveCss = String(power_user?.custom_css || "").trim(); } catch {}
            if (liveCss && !Object.values(S().themes).some(t => t.name === "当前酒馆自定义CSS")) {
                const t = addTheme(createTheme({ name: "当前酒馆自定义CSS", css: liveCss, author: "SillyTavern", tags: ["酒馆", "当前"] }));
                added.push(t.id);
            }
        }
        if (added.length) { saveSettingsDebounced(); renderList(); }
        if (manual) {
            toastr.info(added.length
                ? `已同步 ${added.length} 项`
                : (list.length ? "没有新项（可能已全部导入）" : "接口未返回 themes，请确认酒馆版本"));
        }
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
        { re: /position\s*:\s*fixed/g, lv: "⚠️", hint: () => "position:fixed 可能遮挡输入区" },
    ];
    function auditMobile(css) {
        const issues = [];
        for (const r of MOBILE_RULES) {
            r.re.lastIndex = 0; let m;
            while ((m = r.re.exec(css))) issues.push(`L${css.slice(0, m.index).split("\n").length} ${r.lv} ${r.hint(m)}`);
        }
        return issues.length ? issues : ["✅ 未发现明显移动端问题"];
    }
    function buildMobileFix() {
        return "/* auto mobile-fix */\n@media (max-width:425px){\n  #chat,.mes,.mes_block,.mes_text,#send_form,#form_sheld{min-width:0!important;max-width:100%!important}\n}";
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
    async function createEditor(container, { value = "", onChange, onSave, onCursor } = {}) {
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
            if (onCursor) {
                let ct;
                const emit = () => {
                    clearTimeout(ct);
                    ct = setTimeout(() => {
                        try { onCursor(cm.getValue(), cm.indexFromPos(cm.getCursor())); } catch {}
                    }, 100);
                };
                cm.on("cursorActivity", emit);
                cm.on("mousedown", emit);
            }
            return { _cm: cm, getValue: () => cm.getValue(), setValue: v => cm.setValue(v || ""), focus: () => cm.focus(), refresh: () => cm.refresh() };
        } catch (e) {
            console.warn("[美化管理] CodeMirror 降级", e);
            const ta = document.createElement("textarea");
            ta.className = "tm-plain-editor"; ta.value = value || ""; ta.spellcheck = false;
            container.appendChild(ta);
            ta.addEventListener("input", () => onChange?.(ta.value));
            if (onCursor) {
                const emit = () => onCursor(ta.value, ta.selectionStart || 0);
                ta.addEventListener("click", emit);
                ta.addEventListener("keyup", emit);
            }
            return { _ta: ta, getValue: () => ta.value, setValue: v => { ta.value = v || ""; }, focus: () => ta.focus(), refresh: () => {} };
        }
    }

    function selectorsAtCursor(css, index) {
        if (!css || index < 0) return [];
        let i = Math.min(index, css.length - 1);
        while (i > 0 && css[i] !== "{") {
            if (css[i] === "}" && i < index) break;
            i--;
        }
        if (css[i] !== "{") return [];
        let j = i - 1;
        while (j >= 0 && css[j] !== "}") j--;
        let raw = css.slice(j + 1, i).replace(/\/\*[\s\S]*?\*\//g, "").trim();
        if (!raw) return [];
        if (raw.includes("{")) raw = raw.slice(raw.lastIndexOf("{") + 1).trim();
        if (!raw || raw.startsWith("@")) return [];
        return raw.split(",").map(s => s.trim()).filter(s => s && !s.startsWith("@"));
    }
    let _hlTimer = null;
    function clearPageHighlight() {
        document.querySelectorAll(".tm-hl").forEach(el => el.classList.remove("tm-hl"));
    }
    function highlightInPage(selectors) {
        clearTimeout(_hlTimer);
        clearPageHighlight();
        if (!selectors?.length) return;
        let first = null;
        for (const sel of selectors) {
            let list;
            try { list = document.querySelectorAll(sel); } catch { continue; }
            list.forEach(el => {
                if (el.closest("#tm_panel, #tm_edit, #tm_report, #tm_menu_entry, #tm_floating_menu")) return;
                el.classList.add("tm-hl");
                if (!first) first = el;
            });
        }
        if (first) {
            try { first.scrollIntoView({ block: "center", behavior: "smooth" }); } catch {}
        }
        _hlTimer = setTimeout(clearPageHighlight, 2500);
    }
    function parseCssRules(css) {
        const rules = [];
        const src = String(css || "");
        let i = 0;
        while (i < src.length) {
            if (src[i] === "/" && src[i + 1] === "*") {
                const end = src.indexOf("*/", i + 2);
                i = end < 0 ? src.length : end + 2;
                continue;
            }
            if (src[i] === "{") {
                let s = i - 1;
                while (s >= 0 && /\s/.test(src[s])) s--;
                let start = s;
                while (start >= 0 && src[start] !== "}" && src[start] !== "{") start--;
                start += 1;
                while (start < i && /\s/.test(src[start])) start++;
                let sel = src.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, "").trim();
                let depth = 0, j = i;
                for (; j < src.length; j++) {
                    if (src[j] === "/" && src[j + 1] === "*") {
                        const e = src.indexOf("*/", j + 2);
                        j = e < 0 ? src.length : e + 1;
                        continue;
                    }
                    if (src[j] === "{") depth++;
                    else if (src[j] === "}") {
                        depth--;
                        if (depth === 0) { j++; break; }
                    }
                }
                if (sel && !sel.startsWith("@")) {
                    const parts = sel.split("{");
                    sel = parts[parts.length - 1].trim();
                    if (sel && !sel.startsWith("@")) rules.push({ selector: sel, start, brace: i, end: j });
                }
                i = j;
                continue;
            }
            i++;
        }
        return rules;
    }
    function rulesMatchingElement(css, el) {
        if (!el || !css) return [];
        const hit = [];
        for (const rule of parseCssRules(css)) {
            for (const sel of rule.selector.split(",").map(s => s.trim()).filter(Boolean)) {
                try {
                    if (el.matches(sel)) { hit.push({ ...rule, matched: sel }); break; }
                } catch {}
            }
        }
        hit.sort((a, b) => b.matched.length - a.matched.length);
        return hit;
    }
    function jumpEditorToIndex(index) {
        const ed = ED.editor;
        if (!ed) return;
        if (ed._cm) {
            const cm = ed._cm;
            const pos = cm.posFromIndex(Math.max(0, index));
            cm.setCursor(pos);
            cm.scrollIntoView(pos, 80);
            cm.focus();
            return;
        }
        if (ed._ta) {
            const ta = ed._ta;
            ta.focus();
            ta.setSelectionRange(index, index);
            const lines = ta.value.slice(0, index).split("\n").length;
            ta.scrollTop = Math.max(0, (lines - 5) * 16);
        }
    }
    function onPagePick(e) {
        if (!ED.themeId || $("#tm_edit").hasClass("tm-hidden")) return;
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.closest("#tm_panel, #tm_edit, #tm_report, #tm_menu_entry, #tm_floating_menu, #extensionsMenu")) return;
        if (t === document.documentElement || t === document.body) return;
        const css = ED.editor?.getValue?.() || "";
        let el = t, hits = [];
        while (el && el !== document.body) {
            hits = rulesMatchingElement(css, el);
            if (hits.length) break;
            el = el.parentElement;
        }
        if (!hits.length) {
            toastr?.info?.("当前 CSS 中没有匹配该元素的规则");
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const best = hits[0];
        jumpEditorToIndex(best.start);
        clearPageHighlight();
        el.classList.add("tm-hl");
        clearTimeout(_hlTimer);
        _hlTimer = setTimeout(clearPageHighlight, 2500);
        toastr?.info?.(`已跳到：${best.matched.slice(0, 48)}${best.matched.length > 48 ? "…" : ""}`);
    }
    function enablePagePick() {
        document.addEventListener("click", onPagePick, true);
        document.body.classList.add("tm-pick-mode");
    }
    function disablePagePick() {
        document.removeEventListener("click", onPagePick, true);
        document.body.classList.remove("tm-pick-mode");
        clearPageHighlight();
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

    function handleMoreAction(id, act) {
        const t = S().themes[id]; if (!t) return;
        switch (act) {
            case "export": exportTheme(id, true); break;
            case "exportExt": exportTheme(id, false); break;
            case "pvgen": {
                const pv = gradientPreviewDataUrl(buildActiveCss(t, S().toggles[id]) || t.rawCss, 360, 240);
                setPreview(id, pv).then(() => { renderList(); toastr?.success?.("预览图已生成"); });
                break;
            }
            case "pvd": setPreview(id, "").then(() => { renderList(); toastr?.info?.("预览图已删除"); }); break;
            case "dup": {
                const n = createTheme({ name: t.name + " 副本", css: t.rawCss, author: t.author, tags: [...(t.tags||[])], scope: t.scope });
                addTheme(n); ensureThumb(n); renderList(); break;
            }
            case "audit": showReport(`移动端体检 · ${t.name}`, auditMobile(buildActiveCss(t, S().toggles[id]))); break;
            case "fix":
                S().mobileFix[id] = { enabled: true, css: buildMobileFix() };
                saveSettingsDebounced(); refreshAll(); toastr?.success?.("已生成 mobile-fix"); break;
            case "fixdel":
                delete S().mobileFix[id]; saveSettingsDebounced(); refreshAll(); toastr?.info?.("已删除移动修复"); break;
            case "del": deleteTheme(id); break;
        }
    }
    function toggleMoreMenu($btn) {
        const $card = $btn.closest(".tm-card");
        const id = String($card.data("theme") || "");
        const t = S().themes[id]; if (!t) return;
        $("#tm_floating_menu").remove();
        const hasFix = !!S().mobileFix[id];
        const rect = $btn[0].getBoundingClientRect();
        const $menu = $(`<div id="tm_floating_menu" class="tm-menu" data-theme="${id}">
          <button type="button" class="tm-mi" data-act="export">导出（酒馆格式）</button>
          <button type="button" class="tm-mi" data-act="exportExt">导出（扩展格式）</button>
          <button type="button" class="tm-mi" data-act="pvgen">生成预览图</button>
          <button type="button" class="tm-mi" data-act="pvd">删除预览图</button>
          <button type="button" class="tm-mi" data-act="dup">复制一份</button>
          <button type="button" class="tm-mi" data-act="audit">移动端体检</button>
          <button type="button" class="tm-mi" data-act="fix">${hasFix?"重建移动修复":"一键移动修复"}</button>
          ${hasFix?`<button type="button" class="tm-mi" data-act="fixdel">删除移动修复</button>`:""}
          <button type="button" class="tm-mi tm-danger" data-act="del">删除主题</button>
        </div>`);
        $("body").append($menu);
        const mw = $menu.outerWidth() || 180;
        const mh = $menu.outerHeight() || 240;
        let left = rect.right - mw;
        let top = rect.bottom + 4;
        if (left < 8) left = 8;
        if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 4);
        $menu.css({ position: "fixed", left, top, zIndex: 32000 });
        $menu.on("click", ".tm-mi", function (e) {
            e.preventDefault(); e.stopPropagation();
            const act = $(this).data("act");
            $("#tm_floating_menu").remove();
            handleMoreAction(id, act);
        });
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
                        ED.liveTimer = setTimeout(() => setLivePreviewCss(v), 280);
                    },
                    onSave: () => saveEditor(),
                    onCursor: (css, index) => {
                        const sels = selectorsAtCursor(css, index);
                        if (sels.length) highlightInPage(sels);
                    },
                });
            }
            const css = String(t.rawCss || "");
            ED.editor.setValue(css);
            ED.dirty = false;
            setLivePreviewCss(css);
            refreshAll();
            enablePagePick();
            requestAnimationFrame(() => { try { ED.editor.refresh(); } catch {} });
            ED.editor.focus();
            toastr?.info?.("真实预览：改代码即生效；点页面可跳到规则");
        } catch (e) {
            console.error("[美化管理] openEditor", e);
            toastr?.error?.("打开编辑失败：" + (e.message || e));
        }
    }
    function closeEditor() {
        if (ED.dirty && !confirm("有未保存改动，仍要离开？")) return;
        disablePagePick();
        clearLivePreview();
        clearPageHighlight();
        ED.themeId = null; ED.dirty = false;
        $("#tm_edit").addClass("tm-hidden");
        $("#tm_panel").removeClass("tm-hidden");
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
            <span class="tm-edit-info">真实预览 · 点页面跳转规则 · 光标高亮 · Ctrl+S · Esc</span>
            <button type="button" id="tm_edit_save" class="menu_button">保存</button>
          </div>
          <div class="tm-edit-body"><div id="tm_edit_code"></div></div>
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
            });

        $(document).on("click.tm_menu", e => {
            if ($(e.target).closest(".tm-more, #tm_floating_menu").length) return;
            $("#tm_floating_menu").remove();
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
                if (ids.length) console.info(`[美化管理] 自动导入 ${ids.length} 个`);
                renderList();
            } catch (e) { console.warn("[美化管理] 启动同步失败", e); }
        })();
        console.info("[美化管理] v0.7.4 已启动");
    }

    if (event_types?.APP_READY) {
        eventSource.on(event_types.APP_READY, boot);
        setTimeout(() => { if (!$("#tm_panel").length) boot(); }, 1500);
    } else {
        jQuery(boot);
    }
})();
