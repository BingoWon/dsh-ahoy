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
		/** 把字节数收成卡片上的短数字。空值保持破折号，不假装读到了 0。 */
		function formatBytes(value) {
			if (value === null || !Number.isFinite(value) || value < 0) return "—";
			const units = [
				"B",
				"KB",
				"MB",
				"GB",
				"TB"
			];
			let size = value;
			let unit = 0;
			while (size >= 1024 && unit < units.length - 1) {
				size /= 1024;
				unit += 1;
			}
			const digits = unit === 0 || size >= 10 ? 0 : 1;
			return `${size.toFixed(digits)} ${units[unit]}`;
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
			const [machines, setMachines] = (0, react.useState)([]);
			const [rows, setRows] = (0, react.useState)([]);
			(0, react.useEffect)(() => {
				let stopped = false;
				const tick = async () => {
					try {
						const response = await fetch("/ahoy/tree");
						if (!response.ok) return;
						const body = await response.json();
						const next = Array.isArray(body.sessions) ? body.sessions : [];
						if (!stopped) {
							setRows(next);
							setMachines(Array.isArray(body.machines) ? body.machines : []);
						}
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
			return {
				machines,
				rows
			};
		}
		function machineLine(machine) {
			if (machine.error !== void 0) return machine.error;
			return `CPU ${machine.cpuPercent === null ? "—" : `${Math.round(machine.cpuPercent)}%`} · 内存 ${formatBytes(machine.memoryUsedBytes)} / ${formatBytes(machine.memoryTotalBytes)} · 磁盘 ${formatBytes(machine.diskUsedBytes)} / ${formatBytes(machine.diskTotalBytes)}`;
		}
		function useApprovals() {
			const [items, setItems] = (0, react.useState)([]);
			(0, react.useEffect)(() => {
				let stopped = false;
				const tick = async () => {
					try {
						const response = await fetch("/ahoy/approvals");
						if (!response.ok) return;
						const body = await response.json();
						if (!stopped) setItems(Array.isArray(body.items) ? body.items : []);
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
			}, []);
			return items;
		}
		function decide(item, outcome) {
			fetch("/ahoy/approvals", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					peer: item.peer,
					sessionId: item.sessionId,
					outcome
				})
			});
		}
		function MachineList({ sessions }) {
			const text = dictionary();
			const { machines } = useRemoteSessions(sessions);
			const approvals = useApprovals();
			return (0, react.createElement)("section", { style: {
				padding: "16px",
				lineHeight: 1.5
			} }, (0, react.createElement)("h2", { style: {
				margin: "0 0 8px",
				fontSize: "16px"
			} }, text.title), approvals.map((item) => (0, react.createElement)("article", {
				key: `${item.peer}:${item.sessionId}`,
				style: { marginBottom: "12px" }
			}, (0, react.createElement)("p", { style: { margin: "0 0 8px" } }, `${item.toolName || "审批"} · ${item.reason ?? item.sessionId}`), (0, react.createElement)("button", {
				type: "button",
				onClick: () => decide(item, "allowed-once")
			}, "允许一次"), (0, react.createElement)("button", {
				type: "button",
				onClick: () => decide(item, "rejected"),
				style: { marginLeft: "8px" }
			}, "拒绝"))), machines.length === 0 ? (0, react.createElement)("p", { style: { margin: 0 } }, text.empty) : machines.map((machine) => (0, react.createElement)("article", {
				key: machine.peer,
				style: { marginBottom: "12px" }
			}, (0, react.createElement)("strong", null, machine.peer), (0, react.createElement)("p", { style: { margin: "4px 0" } }, machineLine(machine)), machine.sessions.length === 0 ? null : (0, react.createElement)("ul", { style: {
				margin: 0,
				paddingLeft: "18px"
			} }, machine.sessions.map((session) => (0, react.createElement)("li", { key: session.sessionId }, session.title))))));
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