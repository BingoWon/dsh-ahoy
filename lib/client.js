window.__ModuleLoader__.load({
	id: "dsh-ahoy",
	factory: (require) => {
		var module = { exports: {} };
		module.exports;
		let react = require("react");
		// src/tree.ts
		/** 对方会话在官方会话树里使用的标识。前缀避免和本机会话撞车。 */
		function remoteSessionId(peer, sessionId) {
			return `ahoy:${encodeURIComponent(peer)}:${sessionId}`;
		}
		/** 只为还没宣布过的对方会话产生官方树帧。 */
		function framesForNewSessions(seen, sessions) {
			const frames = [];
			for (const session of sessions) {
				const sessionId = remoteSessionId(session.peer, session.sessionId);
				if (seen.has(sessionId)) continue;
				seen.add(sessionId);
				frames.push({
					type: "host/session-added",
					sessionId,
					blank: false
				});
				frames.push({
					type: "session/projection",
					sessionId,
					key: "title",
					value: session.title,
					seq: 0
				});
			}
			return frames;
		}
		// src/client/index.tsx
		/**
		* 客户端：设置页、侧边栏，以及把对方会话宣布进官方会话树。
		* 桌面应用加载的是同一套客户端。
		*/
		const NS = "dsh-ahoy";
		const announced = /* @__PURE__ */ new Set();
		const zh = {
			"settings.tab": "Ahoy",
			"sidebar.label": "Ahoy",
			title: "机器",
			empty: "还没有配对的机器。"
		};
		const en = {
			"settings.tab": "Ahoy",
			"sidebar.label": "Ahoy",
			title: "Machines",
			empty: "No paired machines."
		};
		function dictionary() {
			return (typeof navigator === "undefined" ? "zh" : navigator.language.toLowerCase()).startsWith("zh") ? zh : en;
		}
		function useRemoteSessions(sessions) {
			const [rows, setRows] = (0, react.useState)([]);
			(0, react.useEffect)(() => {
				let stopped = false;
				const tick = async () => {
					try {
						const response = await fetch("/ahoy/tree");
						if (!response.ok) return;
						const body = await response.json();
						const next = Array.isArray(body.sessions) ? body.sessions : [];
						if (!stopped) setRows(next);
						for (const frame of framesForNewSessions(announced, next)) sessions?.handleHostEnvelope?.({
							type: "server-request",
							rpcId: "ahoy",
							method: "events.host",
							payload: frame
						});
					} catch {}
				};
				tick();
				const timer = setInterval(() => {
					tick();
				}, 2e3);
				return () => {
					stopped = true;
					clearInterval(timer);
				};
			}, [sessions]);
			return rows;
		}
		function MachineList({ sessions }) {
			const text = dictionary();
			const rows = useRemoteSessions(sessions);
			return (0, react.createElement)("section", { style: {
				padding: "16px",
				lineHeight: 1.5
			} }, (0, react.createElement)("h2", { style: {
				margin: "0 0 8px",
				fontSize: "16px"
			} }, text.title), rows.length === 0 ? (0, react.createElement)("p", { style: { margin: 0 } }, text.empty) : (0, react.createElement)("ul", { style: {
				margin: 0,
				paddingLeft: "18px"
			} }, rows.map((row) => (0, react.createElement)("li", { key: `${row.peer}:${row.sessionId}` }, `${row.title} · ${row.peer}`))));
		}
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-ahoy: dictionaries");
			const t = ctx.locale.bind(NS);
			const page = (props) => (0, react.createElement)(MachineList, props);
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "dsh-ahoy",
				order: 40,
				label: () => t("settings.tab"),
				locale: NS,
				inject: () => ({ sessions: ctx.sessions })
			}, page));
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: "dsh-ahoy",
				order: 40,
				label: () => t("sidebar.label"),
				locale: NS
			}, () => null));
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: "dsh-ahoy",
				locale: NS,
				inject: () => ({ sessions: ctx.sessions })
			}, page));
		}
		module.exports = {
			name: "dsh-ahoy",
			inject: [
				"slots",
				"locale",
				"sessions"
			],
			apply
		};
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map