	import { buildMockChatHTML } from "./mock-dom.js";
	const DEVICES = {
	    mobile:    { w: 390,  h: 720, icon: "📱", label: "手机" },
	    landscape: { w: 844,  h: 390, icon: "↔️", label: "横屏" },
	    tablet:    { w: 768,  h: 900, icon: "📋", label: "平板" },
	    pc:        { w: 1920, h: 940, icon: "🖥", label: "PC" },
	};
	export class PreviewManager {
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
	        this.setMsgCount(this.msgCount);   // 触发首次 rebuild
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
	    /** 缩放：PC 1920 装进半屏也要能看（transform 等比缩小） */
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
	        frame.onload = () => { this.setCss(this.css); this.relayout(); }; // 重载后重挂最新 CSS
	        frame.srcdoc = buildMockChatHTML({ msgCount: this.msgCount, themeCss: this.css });
	    }
	    /** 实时生效：只改 iframe 里的 <style>，不重建整页（打字时丝滑） */
	    setCss(css) {
	        this.css = css;
	        const el = this.$frame?.[0]?.contentDocument?.getElementById?.("tm-preview-style");
	        if (el) el.textContent = css;
	    }
	    destroy() { $(window).off("resize", this._onWinResize); }
	    /** 📸 生成 PNG 缩略图：SVG foreignObject 序列化 → canvas（纯 CSS 效果可用） */
	    async capturePng(maxW = 640) {
	        const doc = this.$frame[0].contentDocument;
	        if (!doc?.body) throw new Error("预览尚未就绪，请先刷新再试");
	        const d = DEVICES[this.device];
	        const clone = doc.documentElement.cloneNode(true);
	        clone.querySelectorAll(".tm-hint").forEach(el => el.remove());
	        const xhtml = new XMLSerializer().serializeToString(clone);
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
