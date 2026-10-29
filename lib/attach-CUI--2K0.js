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
export { promptPeer as a, startPeer as c, remoteListItem as i, parseRemoteSessionId as n, readPeer as o, promptRemote as r, sessionsFromHost as s, listWithPeers as t };

//# sourceMappingURL=attach-CUI--2K0.js.map