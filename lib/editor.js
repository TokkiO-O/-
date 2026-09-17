	/* 代码模式编辑器：CodeMirror 5（CDN 动态加载，失败自动降级纯文本框） */
	const CM_VER = "5.65.18";
	const CM = `https://cdn.jsdelivr.net/npm/codemirror@${CM_VER}`;
	const _loaded = {};
	const loadScript = src => _loaded[src] ? Promise.resolve() : new Promise((ok, no) => {
	    const s = document.createElement("script"); s.src = src;
	    s.onload = () => { _loaded[src] = 1; ok(); }; s.onerror = () => no(new Error("加载失败 " + src));
	    document.head.appendChild(s);
	});
	const loadStyle = href => _loaded[href] ? Promise.resolve() : new Promise((ok, no) => {
	    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href;
	    l.onload = () => { _loaded[href] = 1; ok(); }; l.onerror = () => no(new Error("样式失败 " + href));
	    document.head.appendChild(l);
	});
	async function ensureCodeMirror() {
	    if (window.CodeMirror?.cssModeReady) return;
	    await loadStyle(`${CM}/lib/codemirror.min.css`);
	    await loadStyle(`${CM}/theme/material-darker.min.css`);
	    await loadStyle(`${CM}/addon/fold/foldgutter.min.css`);
	    await loadStyle(`${CM}/addon/dialog/dialog.min.css`);
	    await loadStyle(`${CM}/addon/lint/lint.min.css`);
	    await loadScript(`${CM}/lib/codemirror.min.js`);
	    await Promise.all([
	        loadScript(`${CM}/mode/css/css.min.js`),
	        loadScript(`${CM}/addon/edit/closebrackets.min.js`),
	        loadScript(`${CM}/addon/edit/matchbrackets.min.js`),
	        loadScript(`${CM}/addon/selection/active-line.min.js`),
	        loadScript(`${CM}/addon/fold/foldcode.min.js`),
	        loadScript(`${CM}/addon/fold/foldgutter.min.js`),
	        loadScript(`${CM}/addon/fold/brace-fold.min.js`),
	        loadScript(`${CM}/addon/dialog/dialog.min.js`),
	        loadScript(`${CM}/addon/search/searchcursor.min.js`),
	        loadScript(`${CM}/addon/search/search.min.js`),
	        loadScript(`${CM}/addon/search/jump-to-line.min.js`),
	        loadScript(`${CM}/addon/lint/lint.min.js`),
	    ]);
	    window.CodeMirror.cssModeReady = true;
	}
	/* ---------- 无效属性白名单（常用属性；--变量与 -vendor- 前缀免检） ---------- */
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
	margin-bottom,margin-inline,margin-inline-end,margin-inline-start,margin-left,margin-right,margin-top,mask,
	mask-clip,mask-composite,mask-image,mask-mode,mask-origin,mask-position,mask-repeat,mask-size,max-height,
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
	scroll-snap-type,scroll-snap-stop,scroll-margin,scroll-padding,forced-color-adjust
	`.split(",").map(s => s.trim()).filter(Boolean));
	/* ---------- 自定义 lint：无效属性 / 括号不配对 / !important 滥用 ---------- */
	export function cssLint(text, CMRef) {
	    const anns = [];
	    const pos = idx => {
	        const line = text.slice(0, idx).split("\n").length - 1;
	        const ch = idx - (text.lastIndexOf("\n", idx - 1) + 1);
	        return CMRef ? CMRef.Pos(line, ch) : { line, ch };
	    };
	    // 1) 括号 / 字符串 / 注释 扫描
	    let bal = 0, i = 0, inStr = null;
	    while (i < text.length) {
	        const c = text[i];
	        if (c === "\n") { /* 行号由 pos() 自算 */ }
	        else if (inStr) { if (c === inStr) inStr = null; }
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
	    // 2) 无效属性（选择器与 @media 条件因不带分号结尾不会误报）
	    const declRe = /(?:^|[{;])\s*(-{0,2}[A-Za-z][\w-]*)\s*:/g;
	    let m;
	    while ((m = declRe.exec(text))) {
	        const prop = m[1];
	        if (prop.startsWith("--") || prop.startsWith("-")) continue;   // CSS 变量 / 厂商前缀免检
	        if (!KNOWN_PROPS.has(prop.toLowerCase())) {
	            const idx = m.index + m[0].indexOf(prop);
	            anns.push({ from: pos(idx), to: pos(idx + prop.length), severity: "warning", message: `疑似无效属性：${prop}（检查拼写？）` });
	        }
	    }
	    // 3) !important 滥用
	    const imps = [...text.matchAll(/!\s*important/gi)];
	    if (imps.length > 8) {
	        anns.push({ from: pos(imps[0].index), to: pos(imps[0].index + 9), severity: "info",
	            message: `!important 共出现 ${imps.length} 次——滥用会让覆盖链失效（M8 将可视化），建议降低优先级写法` });
	    }
	    return anns;
	}
	/* ---------- 零依赖 CSS 格式化 ---------- */
	export function formatCss(css, unit = "  ") {
	    css = String(css).replace(/\r\n?/g, "\n").trim();
	    let out = "", depth = 0, i = 0;
	    const n = css.length;
	    const atLineStart = () => out === "" || /(^|\n)[ \t]*$/.test(out);
	    const newLine = () => { if (!atLineStart()) out += "\n" + unit.repeat(depth); };
	    while (i < n) {
	        const c = css[i];
	        if (c === "/" && css[i + 1] === "*") {                       // 注释整段保留、独立成行
	            const end = css.indexOf("*/", i + 2);
	            const stop = end === -1 ? n : end + 2;
	            newLine(); out += css.slice(i, stop); out += "\n" + unit.repeat(depth);
	            i = stop; continue;
	        }
	        if (c === '"' || c === "'") {                                 // 字符串原样
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
	/* ---------- 编辑器工厂（统一接口，UI 层不关心底层是 CM 还是 textarea） ---------- */
	export async function createEditor(container, { value = "", onChange = null, onSave = null } = {}) {
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
	    } catch (e) {
	        console.warn("[ThemeManager] CodeMirror 加载失败，降级纯文本编辑", e);
	        window.toastr?.info?.("CodeMirror 加载失败（无网络/CDN 被墙），已降级为纯文本编辑：语法高亮与搜索暂不可用");
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
