import { c as readPeer, i as promptRemote, l as sessionsFromHost, n as pageRemote, o as pagePeer, s as promptPeer, t as listWithPeers, u as startPeer } from "./attach-DYta4FO1.js";
import { loadPeerUrls } from "./peers.js";
// src/ahoy-tool.ts
/**
* 把一句话交给对方插件。返回值只有会话标识和一句摘要，不包含对方的工具日志。
* 本机的会话桥不会被调用。
*/
async function delegateToPeer(request) {
	const status = await readPeer(request.peer);
	const sessionId = request.sessionId ?? status.sessions[0]?.sessionId;
	if (sessionId === void 0) throw new Error("对方没有可委派的会话");
	const result = await promptPeer(request.peer, sessionId, request.text);
	return {
		sessionId: result.sessionId,
		accepted: true,
		summary: `已交给 ${request.peer} 的会话 ${result.sessionId}`
	};
}
const ahoyTool = {
	name: "ahoy",
	description: "把一句话交给另一台已经配对的 DeepSeek Harness。执行发生在对方机器上。返回会话标识和一句摘要，不返回对方的工具日志。",
	parameters: {
		type: "object",
		properties: {
			peer: {
				type: "string",
				description: "对方插件的地址，例如 http://127.0.0.1:47321"
			},
			text: {
				type: "string",
				description: "要交给对方的话"
			},
			sessionId: {
				type: "string",
				description: "对方已有会话。省略时使用对方列表里的第一场会话。"
			}
		},
		required: ["peer", "text"]
	},
	output: {
		schema: { type: "string" },
		render: (_args, value) => [{
			type: "text",
			text: String(value)
		}]
	},
	async execute(args) {
		if (typeof args.peer !== "string" || typeof args.text !== "string") throw new Error("ahoy 需要 peer 和 text");
		return (await delegateToPeer({
			peer: args.peer,
			text: args.text,
			sessionId: args.sessionId
		})).summary;
	}
};
// src/index.ts
function optionalService(ctx, name) {
	try {
		if (typeof ctx.get === "function") return ctx.get(name);
	} catch {
		return;
	}
}
function peerList() {
	return loadPeerUrls();
}
function registerTree(ctx) {
	const webServer = optionalService(ctx, "webServer");
	if (webServer === void 0 || typeof webServer.register !== "function") return;
	const dispose = webServer.register({
		kind: "exact",
		path: "/ahoy/tree",
		handler(_request, response) {
			(async () => {
				const machines = [];
				const sessions = [];
				for (const peer of peerList()) try {
					const status = await readPeer(peer);
					const rows = status.sessions.map((session) => ({
						sessionId: session.sessionId,
						title: session.title
					}));
					machines.push({
						peer,
						cpuPercent: status.cpuPercent,
						memoryUsedBytes: status.memoryUsedBytes,
						memoryTotalBytes: status.memoryTotalBytes,
						diskUsedBytes: status.diskUsedBytes,
						diskTotalBytes: status.diskTotalBytes,
						sessions: rows
					});
					for (const session of rows) sessions.push({
						peer,
						...session
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					machines.push({
						peer,
						cpuPercent: null,
						memoryUsedBytes: null,
						memoryTotalBytes: null,
						diskUsedBytes: null,
						diskTotalBytes: null,
						sessions: [],
						error: message
					});
				}
				const body = JSON.stringify({
					machines,
					sessions
				});
				response.writeHead(200, {
					"content-type": "application/json; charset=utf-8",
					"content-length": Buffer.byteLength(body)
				});
				response.end(body);
			})();
		}
	});
	ctx.effect(() => dispose, "dsh-ahoy: tree");
}
const name = "dsh-ahoy";
/** 会话服务和工具服务都到齐后再启动。Cordis 不允许读取没有声明的服务。 */
const inject = ["sessionController", "tools"];
function installOfficialAttach(ctx) {
	const peers = peerList();
	if (peers.length === 0) return;
	const face = (typeof ctx.get === "function" ? ctx.get("sessionController") : void 0) ?? ctx.sessionController;
	if (face === void 0 || typeof face.list !== "function" || typeof face.prompt !== "function") return;
	const originalList = face.list.bind(face);
	const originalPrompt = face.prompt.bind(face);
	console.error(`[dsh-ahoy] 官方会话列表会带上 ${peers.length} 个对方地址`);
	face.list = async (request, signal) => listWithPeers(await originalList(request, signal), peers);
	face.prompt = async (request, signal) => {
		const forwarded = await promptRemote(request);
		if (forwarded !== void 0) return forwarded;
		return originalPrompt(request, signal);
	};
	const wrapPage = (original) => async (request, signal) => {
		const sessionId = request.address?.kind === "session" ? request.address.sessionId : void 0;
		if (typeof sessionId === "string") {
			const forwarded = await pageRemote(sessionId, request);
			if (forwarded !== void 0) return forwarded;
		}
		return original(request, signal);
	};
	const originalPage = typeof face.page === "function" ? face.page.bind(face) : void 0;
	const originalEvents = typeof face.events === "function" ? face.events.bind(face) : void 0;
	if (originalPage !== void 0) face.page = wrapPage(originalPage);
	if (originalEvents !== void 0) face.events = wrapPage(originalEvents);
	ctx.effect(() => () => {
		face.list = originalList;
		face.prompt = originalPrompt;
		if (originalPage !== void 0) face.page = originalPage;
		if (originalEvents !== void 0) face.events = originalEvents;
	}, "dsh-ahoy: attach");
}
function apply(ctx) {
	registerTree(ctx);
	const bridge = sessionsFromHost(ctx);
	installOfficialAttach(ctx);
	const listen = process.env.DSH_AHOY_LISTEN;
	let closePeer;
	let stopped = false;
	if (listen !== void 0 && listen !== "") {
		const port = Number(listen);
		if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`DSH_AHOY_LISTEN 不是端口: ${listen}`);
		startPeer(port, bridge).then((handle) => {
			if (stopped) {
				handle.close();
				return;
			}
			closePeer = handle.close;
		}, (error) => {
			console.error("[dsh-ahoy] 本机监听失败:", error);
		});
		ctx.effect(() => () => {
			stopped = true;
			closePeer?.();
		}, "dsh-ahoy: peer");
	} else ctx.effect(() => () => {}, "dsh-ahoy: idle");
	const face = (typeof ctx.get === "function" ? ctx.get("tools") : void 0) ?? ctx.tools;
	if (face !== void 0 && typeof face.register === "function") {
		const dispose = face.register(ahoyTool);
		ctx.effect(() => dispose, "dsh-ahoy: tool");
	}
}
export { apply, delegateToPeer, inject, name, pagePeer, promptPeer, readPeer, sessionsFromHost, startPeer };

//# sourceMappingURL=index.js.map