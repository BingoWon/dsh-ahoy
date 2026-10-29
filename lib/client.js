window.__ModuleLoader__.load({
	id: "dsh-ahoy",
	factory: (require) => {
		var module = { exports: {} };
		module.exports;
		let react = require("react");
		// src/client/index.tsx
		/**
		* 客户端：设置里的 Ahoy 页，以及侧边栏里的空机器列表。
		* 桌面应用加载的是同一套客户端。
		*/
		const NS = "dsh-ahoy";
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
		function MachineList() {
			const text = dictionary();
			return (0, react.createElement)("section", { style: {
				padding: "16px",
				lineHeight: 1.5
			} }, (0, react.createElement)("h2", { style: {
				margin: "0 0 8px",
				fontSize: "16px"
			} }, text.title), (0, react.createElement)("p", { style: { margin: 0 } }, text.empty));
		}
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-ahoy: dictionaries");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "dsh-ahoy",
				order: 40,
				label: () => t("settings.tab"),
				locale: NS
			}, MachineList));
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
				locale: NS
			}, MachineList));
		}
		module.exports = {
			name: "dsh-ahoy",
			inject: ["slots", "locale"],
			apply
		};
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map