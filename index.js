	/* M4 块解析/装配 + M9 移动端体检（从 v0.1 index.js 迁出，不再依赖设置对象） */
	export function parseBlocks(css) {
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
	export function buildActiveCss(theme, toggles) {
	    const t = toggles || {};
	    return Object.entries(theme.blocks)
	        .filter(([name]) => t[name] !== false)
	        .map(([name, css]) => `/* block: ${name} */\n${css}`)
	        .join("\n\n");
	}
	const MOBILE_RULES = [
	    { re: /(?:^|[;\s])(?:width|height)\s*:\s*(\d{4,})px/g, lv: "❌", hint: m => `固定 ${m[1]}px 超出手机视口(390px)，建议 max-width/百分比` },
	    { re: /min-width\s*:\s*([5-9]\d{2,})px/g, lv: "❌", hint: m => `min-width:${m[1]}px 会撑破 390px 视口` },
	    { re: /padding\s*:\s*(\d{3,})px/g, lv: "⚠️", hint: m => `padding:${m[1]}px 过大，移动端建议 ≤32px` },
	    { re: /position\s*:\s*fixed/g, lv: "⚠️", hint: () => "position:fixed 易遮挡手机输入区，建议包进 @media (hover:hover)" },
	];
	export function auditMobile(css) {
	    const issues = [];
	    for (const r of MOBILE_RULES) {
	        r.re.lastIndex = 0;
	        let m;
	        while ((m = r.re.exec(css))) {
	            issues.push(`L${css.slice(0, m.index).split("\n").length} ${r.lv} ${r.hint(m)}`);
	        }
	    }
	    css.split("\n").forEach((l, i) => {
	        if (/:(hover)\b/.test(l) && !/@media/.test(l)) issues.push(`L${i + 1} ℹ️ :hover 在触屏无效，建议补 :active/:focus-visible`);
	    });
	    return issues.length ? issues : ["✅ 未发现明显移动端问题"];
	}
	export function buildMobileFix() {
	    return [
	        "/* auto mobile-fix（独立层，可单独删除） */",
	        "@media (max-width: 425px) {",
	        "  #chat, .mes, .mes_block, .mes_text, #send_form, #form_sheld { min-width: 0 !important; max-width: 100% !important; }",
	        "  .mes { padding: 8px !important; }",
	        "}",
	    ].join("\n");
	}
