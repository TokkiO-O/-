	/* iframe 沙盒预览用的"假酒馆"页面。
	 * 关键：选择器全部与真实站一致 ——
	 * #top-bar / #sheld / #chat / .mes(.is_user/.last_mes) / .mes_block / .ch_name / .name_text /
	 * .mesAvatarWrapper / .avatar / .mes_text / #form_sheld / #form_sheld_form / #nonQRFormItems /
	 * #leftSendForm / #options_button / #send_textarea / #rightSendForm / #send_but            */
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
	export function buildMockChatHTML({ msgCount = 3, themeCss = "" } = {}) {
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
	    // 防止用户 CSS 里的 </style> 截断文档
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
	<div id="top-bar-icons"><span title=" Wand">🪄</span><span title="设置">⚙️</span></div>
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
