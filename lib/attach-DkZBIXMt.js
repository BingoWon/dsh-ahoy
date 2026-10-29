import { remoteSessionId } from "./tree.js";
import { createServer } from "node:http";
import { cpus, freemem, totalmem } from "node:os";
import { statfsSync } from "node:fs";
// src/metrics.ts
let previous;
function totalOf(times) {
	return times.idle + times.user + times.sys + times.nice + times.irq;
}
/** 两次读取之间的 CPU 忙比例。第一次调用只记下起点，不假装有百分比。 */
function readCpuPercent() {
	const now = cpus().map((cpu) => cpu.times);
	const before = previous;
	previous = now;
	if (before === void 0 || before.length !== now.length) return null;
	let idle = 0;
	let total = 0;
	for (let index = 0; index < now.length; index += 1) {
		const next = now[index];
		const last = before[index];
		if (next === void 0 || last === void 0) continue;
		idle += next.idle - last.idle;
		total += totalOf(next) - totalOf(last);
	}
	if (total <= 0) return null;
	return Math.max(0, Math.min(100, (1 - idle / total) * 100));
}
function readMachineStatus(path = "/") {
	const memoryTotalBytes = totalmem();
	let diskUsedBytes = null;
	let diskTotalBytes = null;
	try {
		const stats = statfsSync(path);
		diskTotalBytes = stats.blocks * stats.bsize;
		diskUsedBytes = (stats.blocks - stats.bfree) * stats.bsize;
	} catch {
		diskUsedBytes = null;
		diskTotalBytes = null;
	}
	return {
		cpuPercent: readCpuPercent(),
		memoryUsedBytes: memoryTotalBytes - freemem(),
		memoryTotalBytes,
		diskUsedBytes,
		diskTotalBytes
	};
}
// src/peer.ts
function sendJson(response, status, body) {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload)
	});
	response.end(payload);
}
async function readBody(request) {
	const chunks = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
}
function remoteAddress(request) {
	const address = request.socket.remoteAddress ?? "";
	return address.startsWith("::ffff:") ? address.slice(7) : address;
}
/** 只接受本机连进来。这是两个插件直接说话，不是转发。 */
function startPeer(port, sessions) {
	const server = createServer((request, response) => {
		handle(request, response, sessions);
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(/* @__PURE__ */ new Error("peer did not bind a TCP port"));
				return;
			}
			resolve({
				port: address.port,
				close: () => new Promise((done, fail) => {
					server.close((error) => error ? fail(error) : done());
				})
			});
		});
	});
}
async function handle(request, response, sessions) {
	const address = remoteAddress(request);
	if (address !== "127.0.0.1" && address !== "::1") {
		sendJson(response, 403, { error: "only loopback clients are accepted" });
		return;
	}
	if (request.method !== "POST") {
		sendJson(response, 405, { error: "POST only" });
		return;
	}
	try {
		if (request.url === "/v1/status") {
			sendJson(response, 200, {
				...readMachineStatus(),
				sessions: await sessions.list()
			});
			return;
		}
		if (request.url === "/v1/page") {
			if (sessions.page === void 0) {
				sendJson(response, 404, { error: "history is not available" });
				return;
			}
			const body = JSON.parse(await readBody(request));
			if (typeof body.sessionId !== "string" || body.request === null || typeof body.request !== "object") {
				sendJson(response, 400, { error: "sessionId and request are required" });
				return;
			}
			sendJson(response, 200, await sessions.page(body.sessionId, body.request));
			return;
		}
		if (request.url === "/v1/session") {
			if (sessions.call === void 0) {
				sendJson(response, 404, { error: "session call is not available" });
				return;
			}
			const body = JSON.parse(await readBody(request));
			if (body.method !== "projections" && body.method !== "rename" || typeof body.sessionId !== "string") {
				sendJson(response, 400, { error: "method and sessionId are required" });
				return;
			}
			const extra = body.request !== null && typeof body.request === "object" ? body.request : {};
			sendJson(response, 200, await sessions.call(body.method, body.sessionId, extra));
			return;
		}
		if (request.url === "/v1/cancel") {
			if (sessions.cancel === void 0) {
				sendJson(response, 404, { error: "cancel is not available" });
				return;
			}
			const body = JSON.parse(await readBody(request));
			if (typeof body.sessionId !== "string" || body.sessionId === "") {
				sendJson(response, 400, { error: "sessionId is required" });
				return;
			}
			sendJson(response, 200, await sessions.cancel(body.sessionId));
			return;
		}
		if (request.url === "/v1/prompt") {
			const body = JSON.parse(await readBody(request));
			if (typeof body.sessionId !== "string" || typeof body.text !== "string" || body.text.trim() === "") {
				sendJson(response, 400, { error: "sessionId and text are required" });
				return;
			}
			sendJson(response, 200, await sessions.prompt(body.sessionId, body.text));
			return;
		}
		sendJson(response, 404, { error: "not found" });
	} catch (error) {
		sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
	}
}
async function readPeer(baseUrl) {
	const response = await fetch(new URL("/v1/status", baseUrl), { method: "POST" });
	if (!response.ok) throw new Error(`peer status failed: ${response.status}`);
	return await response.json();
}
async function pagePeer(baseUrl, sessionId, request) {
	const response = await fetch(new URL("/v1/page", baseUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			sessionId,
			request
		})
	});
	if (!response.ok) throw new Error(`peer page failed: ${response.status}`);
	return await response.json();
}
async function callPeer(baseUrl, method, sessionId, request) {
	const response = await fetch(new URL("/v1/session", baseUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			method,
			sessionId,
			request
		})
	});
	if (!response.ok) {
		const body = await response.json().catch(() => void 0);
		throw new Error(typeof body?.error === "string" ? body.error : `peer session failed: ${response.status}`);
	}
	return await response.json();
}
async function cancelPeer(baseUrl, sessionId) {
	const response = await fetch(new URL("/v1/cancel", baseUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionId })
	});
	if (!response.ok) {
		const body = await response.json().catch(() => void 0);
		const message = typeof body?.error === "string" ? body.error : `peer cancel failed: ${response.status}`;
		throw new Error(message);
	}
	return await response.json();
}
async function promptPeer(baseUrl, sessionId, text) {
	const response = await fetch(new URL("/v1/prompt", baseUrl), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			sessionId,
			text
		})
	});
	if (!response.ok) throw new Error(`peer prompt failed: ${response.status}`);
	return await response.json();
}
/** 对方插件调用它所在的那台 DSH。没有会话服务时列表为空，送消息会失败。 */
function sessionsFromHost(ctx) {
	const face = (typeof ctx.get === "function" ? ctx.get("sessionController") : void 0) ?? ctx.sessionController;
	const list = face !== void 0 && typeof face.list === "function" ? face.list.bind(face) : void 0;
	const prompt = face !== void 0 && typeof face.prompt === "function" ? face.prompt.bind(face) : void 0;
	const cancel = face !== void 0 && typeof face.cancel === "function" ? face.cancel.bind(face) : void 0;
	const projections = face !== void 0 && typeof face.projections === "function" ? face.projections.bind(face) : void 0;
	const rename = face !== void 0 && typeof face.rename === "function" ? face.rename.bind(face) : void 0;
	const page = face !== void 0 && typeof face.page === "function" ? face.page.bind(face) : face !== void 0 && typeof face.events === "function" ? face.events.bind(face) : void 0;
	return {
		async list() {
			if (list === void 0) return [];
			return ((await list({}, new AbortController().signal)).items ?? []).flatMap((item) => {
				if (typeof item.sessionId !== "string") return [];
				return [{
					sessionId: item.sessionId,
					title: typeof item.title === "string" ? item.title : item.sessionId
				}];
			});
		},
		async prompt(sessionId, text) {
			if (prompt === void 0) throw new Error("这台 DSH 没有会话接口");
			await prompt({
				sessionId,
				content: [{
					type: "text",
					text
				}],
				mode: "queue",
				requestId: crypto.randomUUID()
			}, new AbortController().signal);
			return {
				accepted: true,
				sessionId
			};
		},
		async call(method, sessionId, request) {
			const target = method === "projections" ? projections : rename;
			if (target === void 0) throw new Error("这台 DSH 没有这个会话接口");
			return await target({
				...request,
				sessionId
			}, new AbortController().signal);
		},
		async cancel(sessionId) {
			if (cancel === void 0) throw new Error("这台 DSH 没有取消接口");
			await cancel({ sessionId }, new AbortController().signal);
			return { accepted: true };
		},
		async page(sessionId, request) {
			if (page === void 0) throw new Error("这台 DSH 没有历史接口");
			return await page({
				...request,
				address: {
					kind: "session",
					sessionId
				}
			}, new AbortController().signal);
		}
	};
}
// src/attach.ts
/** 把 ahoy: 前缀拆回对方地址和原始会话标识。 */
function parseRemoteSessionId(sessionId) {
	if (!sessionId.startsWith("ahoy:")) return void 0;
	const rest = sessionId.slice(5);
	const split = rest.indexOf(":");
	if (split <= 0) return void 0;
	return {
		peer: decodeURIComponent(rest.slice(0, split)),
		sessionId: rest.slice(split + 1)
	};
}
function remoteListItem(peer, session) {
	return {
		agentAvailable: true,
		sessionId: remoteSessionId(peer, session.sessionId),
		updatedAt: Date.now(),
		running: false,
		blank: false,
		projections: {
			kind: "cached",
			asOfSeq: 0,
			values: { title: session.title }
		}
	};
}
/** 官方会话列表加上对方机器的会话。对方自己再列回来的 ahoy: 行不再套一层。 */
async function listWithPeers(local, peers) {
	const items = [...local.items ?? []];
	const seen = new Set(items.flatMap((item) => typeof item.sessionId === "string" ? [item.sessionId] : []));
	for (const peer of peers) {
		let remote = [];
		try {
			remote = (await readPeer(peer)).sessions;
		} catch {
			continue;
		}
		for (const session of remote) {
			if (session.sessionId.startsWith("ahoy:")) continue;
			const sessionId = remoteSessionId(peer, session.sessionId);
			if (seen.has(sessionId)) continue;
			seen.add(sessionId);
			items.push(remoteListItem(peer, session));
		}
	}
	return {
		...local,
		items
	};
}
async function promptRemote(request) {
	const remote = parseRemoteSessionId(request.sessionId);
	if (remote === void 0) return void 0;
	const text = (request.content ?? []).filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
	await promptPeer(remote.peer, remote.sessionId, text);
	return { accepted: true };
}
/** 用对方的原始会话读历史，再把记录里的标识换回官方树上的 ahoy: 标识。 */
async function cancelRemote(sessionId) {
	const remote = parseRemoteSessionId(sessionId);
	if (remote === void 0) return void 0;
	return await cancelPeer(remote.peer, remote.sessionId);
}
async function projectionRemote(sessionId) {
	const remote = parseRemoteSessionId(sessionId);
	if (remote === void 0) return void 0;
	const value = await callPeer(remote.peer, "projections", remote.sessionId, {});
	const encoded = JSON.stringify(value).split(remote.sessionId).join(sessionId);
	return JSON.parse(encoded);
}
async function pageRemote(sessionId, request) {
	const remote = parseRemoteSessionId(sessionId);
	if (remote === void 0) return void 0;
	const page = await pagePeer(remote.peer, remote.sessionId, request);
	const encoded = JSON.stringify(page).split(remote.sessionId).join(sessionId);
	return JSON.parse(encoded);
}
export { projectionRemote as a, pagePeer as c, sessionsFromHost as d, startPeer as f, parseRemoteSessionId as i, promptPeer as l, listWithPeers as n, promptRemote as o, pageRemote as r, remoteListItem as s, cancelRemote as t, readPeer as u };

//# sourceMappingURL=attach-DkZBIXMt.js.map