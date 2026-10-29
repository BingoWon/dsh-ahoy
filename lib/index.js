import { C as startPeer, S as sessionsFromHost, _ as answerPeer, a as forkRemote, b as promptPeer, c as pageRemote, d as promptRemote, f as queueRemote, g as acceptPeer, h as searchWithPeers, i as followRemote, m as renameRemote, n as cancelRemote, o as listWithPeers, r as createOnPeer, s as modelRemote, t as attachmentRemote, u as projectionRemote, v as approvalsPeer, x as readPeer, y as pagePeer } from "./attach-C_h6r9zF.js";
import { loadListenEndpoint, loadPeerUrls, setPeerToken } from "./peers.js";
import { peerForGroup } from "./tree.js";
// src/ahoy-tool.ts
/** 只把话交给已经配对的机器。只有一台时可以不写地址。 */
function resolvePeer(requested, configured) {
	if (configured.length === 0) throw new Error("还没有配对的机器");
	const name = requested?.trim() ?? "";
	if (name === "") {
		if (configured.length === 1) return configured[0] ?? "";
		throw new Error("有多台机器，需要指定 peer");
	}
	const found = configured.find((peer) => peer === name);
	if (found === void 0) throw new Error("这台机器没有配对");
	return found;
}
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
function createAhoyTool(configuredPeers) {
	return {
		name: "ahoy",
		description: "把一句话交给另一台已经配对的 DeepSeek Harness。执行发生在对方机器上。返回会话标识和一句摘要，不返回对方的工具日志。只有一台配对机器时可以不填 peer。",
		parameters: {
			type: "object",
			properties: {
				peer: {
					type: "string",
					description: "已配对机器的地址。只有一台时可以省略。"
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
			required: ["text"]
		},
		output: {
			schema: { type: "string" },
			render: (_args, value) => [{
				type: "text",
				text: String(value)
			}]
		},
		async execute(args) {
			if (typeof args.text !== "string") throw new Error("ahoy 需要 text");
			return (await delegateToPeer({
				peer: resolvePeer(args.peer, configuredPeers()),
				text: args.text,
				sessionId: args.sessionId
			})).summary;
		}
	};
}
// src/approval.ts
/** 从审批请求里取出对方会话标识。没有标识就交给原来的审批链。 */
function sessionIdFromApproval(request) {
	const session = request.agent?.session;
	if (typeof session?.id === "string" && session.id !== "") return session.id;
	if (typeof session?.header?.id === "string" && session.header.id !== "") return session.header.id;
}
function isApprovalOutcome(value) {
	return value === "allowed-once" || value === "rejected";
}
/** 对方机器上等待这一侧点允许或拒绝。超时就交回原来的审批链。 */
var ApprovalDesk = class {
	waiting = /* @__PURE__ */ new Map();
	list() {
		return [...this.waiting.values()].map((item) => ({
			sessionId: item.sessionId,
			toolName: item.toolName,
			...item.reason !== void 0 ? { reason: item.reason } : {}
		}));
	}
	answer(sessionId, outcome) {
		const pending = this.waiting.get(sessionId);
		if (pending === void 0) return false;
		this.waiting.delete(sessionId);
		pending.answer(outcome);
		return true;
	}
	decide(sessionId, info, next, timeoutMs = 12e4) {
		if (this.waiting.has(sessionId)) return Promise.resolve(next());
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.waiting.delete(sessionId);
				resolve(next());
			}, timeoutMs);
			this.waiting.set(sessionId, {
				sessionId,
				toolName: info.toolName,
				...info.reason !== void 0 ? { reason: info.reason } : {},
				answer: (outcome) => {
					clearTimeout(timer);
					this.waiting.delete(sessionId);
					resolve(outcome);
				}
			});
		});
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
	const originalCancel = typeof face.cancel === "function" ? face.cancel.bind(face) : void 0;
	const originalProjections = typeof face.projections === "function" ? face.projections.bind(face) : void 0;
	const originalRename = typeof face.rename === "function" ? face.rename.bind(face) : void 0;
	const originalQueue = typeof face.updateQueue === "function" ? face.updateQueue.bind(face) : void 0;
	const originalModel = typeof face.selectModel === "function" ? face.selectModel.bind(face) : void 0;
	const originalFork = typeof face.fork === "function" ? face.fork.bind(face) : void 0;
	const originalAttachment = typeof face.attachment === "function" ? face.attachment.bind(face) : void 0;
	const originalSearch = typeof face.search === "function" ? face.search.bind(face) : void 0;
	const originalCreate = typeof face.create === "function" ? face.create.bind(face) : void 0;
	const originalFollow = typeof face.follow === "function" ? face.follow.bind(face) : void 0;
	console.error(`[dsh-ahoy] 官方会话列表会带上 ${peers.length} 个对方地址`);
	face.list = async (request, signal) => listWithPeers(await originalList(request, signal), peers);
	face.prompt = async (request, signal) => {
		const forwarded = await promptRemote(request);
		if (forwarded !== void 0) return forwarded;
		return originalPrompt(request, signal);
	};
	if (originalFollow !== void 0) face.follow = (request, signal) => {
		const sessionId = request.address?.kind === "session" ? request.address.sessionId : void 0;
		if (typeof sessionId === "string" && sessionId.startsWith("ahoy:")) return followRemote(sessionId, request, signal);
		return originalFollow(request, signal);
	};
	if (originalCreate !== void 0) face.create = async (request, signal) => {
		const peer = peerForGroup(request.cwd, peers);
		if (peer !== void 0) return createOnPeer(peer, request.agentPreset !== void 0 ? { agentPreset: request.agentPreset } : {});
		return originalCreate(request, signal);
	};
	if (originalSearch !== void 0) face.search = async (request, signal) => {
		let local = {
			items: [],
			hasMore: false
		};
		try {
			local = await originalSearch(request, signal);
		} catch {
			local = {
				items: [],
				hasMore: false
			};
		}
		return searchWithPeers(local, peers, request.query ?? "");
	};
	if (originalAttachment !== void 0) face.attachment = async (request, signal) => {
		const { sessionId, ...rest } = request;
		const forwarded = await attachmentRemote(sessionId, rest);
		if (forwarded !== void 0) return forwarded;
		return originalAttachment(request, signal);
	};
	if (originalFork !== void 0) face.fork = async (request, signal) => {
		const { sessionId, ...rest } = request;
		const forwarded = await forkRemote(sessionId, rest);
		if (forwarded !== void 0) return forwarded;
		return originalFork(request, signal);
	};
	if (originalModel !== void 0) face.selectModel = async (request, signal) => {
		const { sessionId, ...rest } = request;
		const forwarded = await modelRemote(sessionId, rest);
		if (forwarded !== void 0) return forwarded;
		return originalModel(request, signal);
	};
	if (originalQueue !== void 0) face.updateQueue = async (request, signal) => {
		const { sessionId, ...rest } = request;
		const forwarded = await queueRemote(sessionId, rest);
		if (forwarded !== void 0) return forwarded;
		return originalQueue(request, signal);
	};
	if (originalRename !== void 0) face.rename = async (request, signal) => {
		const forwarded = await renameRemote(request.sessionId, request.title);
		if (forwarded !== void 0) return forwarded;
		return originalRename(request, signal);
	};
	if (originalProjections !== void 0) face.projections = async (request, signal) => {
		const forwarded = await projectionRemote(request.sessionId);
		if (forwarded !== void 0) return forwarded;
		return originalProjections(request, signal);
	};
	if (originalCancel !== void 0) face.cancel = async (request, signal) => {
		const forwarded = await cancelRemote(request.sessionId);
		if (forwarded !== void 0) return forwarded;
		return originalCancel(request, signal);
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
		if (originalCancel !== void 0) face.cancel = originalCancel;
		if (originalProjections !== void 0) face.projections = originalProjections;
		if (originalRename !== void 0) face.rename = originalRename;
		if (originalQueue !== void 0) face.updateQueue = originalQueue;
		if (originalModel !== void 0) face.selectModel = originalModel;
		if (originalFork !== void 0) face.fork = originalFork;
		if (originalAttachment !== void 0) face.attachment = originalAttachment;
		if (originalSearch !== void 0) face.search = originalSearch;
		if (originalCreate !== void 0) face.create = originalCreate;
		if (originalFollow !== void 0) face.follow = originalFollow;
		if (originalPage !== void 0) face.page = originalPage;
		if (originalEvents !== void 0) face.events = originalEvents;
	}, "dsh-ahoy: attach");
}
function installApproval(ctx, desk) {
	if (typeof ctx.on !== "function") return;
	try {
		const dispose = ctx.on("approval/request", function(request, next) {
			const sessionId = sessionIdFromApproval(request);
			if (sessionId === void 0) return next();
			return desk.decide(sessionId, {
				toolName: typeof request.toolName === "string" ? request.toolName : "",
				...typeof request.reason === "string" ? { reason: request.reason } : {}
			}, next);
		});
		if (typeof dispose === "function") ctx.effect(() => dispose, "dsh-ahoy: approval");
	} catch (error) {
		console.error("[dsh-ahoy] 没有接上审批:", error);
	}
}
function registerApprovalRoute(ctx) {
	const webServer = optionalService(ctx, "webServer");
	if (webServer === void 0 || typeof webServer.register !== "function") return;
	const dispose = webServer.register({
		kind: "exact",
		path: "/ahoy/approvals",
		handler(request, response) {
			(async () => {
				if (request.method === "GET") {
					const items = [];
					for (const peer of peerList()) try {
						for (const item of await approvalsPeer(peer)) items.push({
							peer,
							...item
						});
					} catch {}
					const body = JSON.stringify({ items });
					response.writeHead(200, {
						"content-type": "application/json; charset=utf-8",
						"content-length": Buffer.byteLength(body)
					});
					response.end(body);
					return;
				}
				const chunks = [];
				for await (const chunk of request) chunks.push(Buffer.from(chunk));
				const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				if (typeof payload.peer !== "string" || typeof payload.sessionId !== "string" || !isApprovalOutcome(payload.outcome)) {
					response.writeHead(400);
					response.end("bad request");
					return;
				}
				if (!peerList().includes(payload.peer)) {
					response.writeHead(403);
					response.end("peer is not paired");
					return;
				}
				const result = await answerPeer(payload.peer, payload.sessionId, payload.outcome);
				const body = JSON.stringify(result);
				response.writeHead(200, {
					"content-type": "application/json; charset=utf-8",
					"content-length": Buffer.byteLength(body)
				});
				response.end(body);
			})().catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
				response.end(message);
			});
		}
	});
	ctx.effect(() => dispose, "dsh-ahoy: approval-route");
}
function registerToolRoute(ctx) {
	const webServer = optionalService(ctx, "webServer");
	if (webServer === void 0 || typeof webServer.register !== "function") return;
	const dispose = webServer.register({
		kind: "exact",
		path: "/ahoy/tool",
		handler(_request, response) {
			const tools = typeof ctx.get === "function" ? ctx.get("tools") : void 0;
			let registered = false;
			try {
				if (typeof tools?.get === "function") registered = tools.get("ahoy") != null;
			} catch {
				registered = false;
			}
			const body = JSON.stringify({
				name: "ahoy",
				registered
			});
			response.writeHead(200, {
				"content-type": "application/json; charset=utf-8",
				"content-length": Buffer.byteLength(body)
			});
			response.end(body);
		}
	});
	ctx.effect(() => dispose, "dsh-ahoy: tool-route");
}
function apply(ctx) {
	const desk = new ApprovalDesk();
	registerTree(ctx);
	registerApprovalRoute(ctx);
	const bridge = sessionsFromHost(ctx, desk);
	installApproval(ctx, desk);
	installOfficialAttach(ctx);
	const listen = loadListenEndpoint();
	let closePeer;
	let stopped = false;
	if (listen !== void 0) {
		const expiresText = process.env.DSH_AHOY_TOKEN_EXPIRES;
		const expiresAt = expiresText !== void 0 && expiresText !== "" ? Number(expiresText) : void 0;
		startPeer(listen.port, bridge, {
			host: listen.host,
			token: process.env.DSH_AHOY_TOKEN,
			expiresAt: expiresAt !== void 0 && Number.isFinite(expiresAt) ? expiresAt : void 0
		}).then((handle) => {
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
		const dispose = face.register(createAhoyTool(peerList));
		ctx.effect(() => dispose, "dsh-ahoy: tool");
	}
	registerToolRoute(ctx);
}
export { ApprovalDesk, acceptPeer, answerPeer, apply, approvalsPeer, createAhoyTool, delegateToPeer, inject, name, pagePeer, promptPeer, readPeer, resolvePeer, sessionIdFromApproval, sessionsFromHost, setPeerToken, startPeer };

//# sourceMappingURL=index.js.map