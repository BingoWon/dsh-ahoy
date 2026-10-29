import { peerAuthHeader } from "./peers.js";
import { machineGroupPath, remoteSessionId } from "./tree.js";
import { timingSafeEqual } from "node:crypto";
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
/** 没有配对令牌时只接受本机。有令牌时才接受 NetBird 或 Tailscale 的虚拟地址。 */
function acceptPeer(address, tokenConfigured) {
	if (address === "127.0.0.1" || address === "::1") return true;
	return tokenConfigured && address !== "";
}
function tokenMatches(request, expected, expiresAt) {
	if (expiresAt !== void 0 && Date.now() >= expiresAt) return false;
	if (expected === void 0 || expected === "") return true;
	const header = request.headers["x-ahoy-token"];
	const got = Array.isArray(header) ? header[0] : header;
	if (typeof got !== "string") return false;
	const left = Buffer.from(got);
	const right = Buffer.from(expected);
	return left.length === right.length && timingSafeEqual(left, right);
}
/** 默认只绑本机。host 写成虚拟地址后，对方才能直接连过来。 */
function startPeer(port, sessions, options) {
	const server = createServer((request, response) => {
		handle(request, response, sessions, options?.token, options?.expiresAt);
	});
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, options?.host ?? "127.0.0.1", () => {
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
async function handle(request, response, sessions, token, expiresAt) {
	if (!acceptPeer(remoteAddress(request), token !== void 0 && token !== "")) {
		sendJson(response, 403, { error: "only loopback clients are accepted" });
		return;
	}
	if (!tokenMatches(request, token, expiresAt)) {
		sendJson(response, 403, { error: "pairing token was rejected" });
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
		if (request.url === "/v1/follow") {
			if (sessions.follow === void 0) {
				sendJson(response, 404, { error: "follow is not available" });
				return;
			}
			const body = JSON.parse(await readBody(request));
			if (typeof body.sessionId !== "string" || body.request === null || typeof body.request !== "object") {
				sendJson(response, 400, { error: "sessionId and request are required" });
				return;
			}
			const controller = new AbortController();
			request.on("close", () => controller.abort());
			response.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
			try {
				for await (const frame of sessions.follow(body.sessionId, body.request, controller.signal)) if (!response.write(`${JSON.stringify(frame)}\n`)) await new Promise((resolve) => response.once("drain", resolve));
			} catch (error) {
				if (!controller.signal.aborted) {
					const message = error instanceof Error ? error.message : String(error);
					response.write(`${JSON.stringify({
						type: "error",
						message
					})}\n`);
				}
			} finally {
				response.end();
			}
			return;
		}
		if (request.url === "/v1/session") {
			if (sessions.call === void 0) {
				sendJson(response, 404, { error: "session call is not available" });
				return;
			}
			const body = JSON.parse(await readBody(request));
			if (body.method !== "projections" && body.method !== "rename" && body.method !== "updateQueue" && body.method !== "selectModel" && body.method !== "fork" && body.method !== "attachment" || typeof body.sessionId !== "string") {
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
		if (request.url === "/v1/search") {
			if (sessions.search === void 0) {
				sendJson(response, 200, { items: [] });
				return;
			}
			const body = JSON.parse(await readBody(request));
			if (typeof body.query !== "string") {
				sendJson(response, 400, { error: "query is required" });
				return;
			}
			sendJson(response, 200, { items: await sessions.search(body.query) });
			return;
		}
		if (request.url === "/v1/approvals") {
			sendJson(response, 200, { items: await sessions.approvals?.() ?? [] });
			return;
		}
		if (request.url === "/v1/approval") {
			if (sessions.answer === void 0) {
				sendJson(response, 404, { error: "approval is not available" });
				return;
			}
			const body = JSON.parse(await readBody(request));
			if (typeof body.sessionId !== "string" || body.outcome !== "allowed-once" && body.outcome !== "rejected") {
				sendJson(response, 400, { error: "sessionId and outcome are required" });
				return;
			}
			sendJson(response, 200, await sessions.answer(body.sessionId, body.outcome));
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
	const response = await fetch(new URL("/v1/status", baseUrl), {
		method: "POST",
		headers: peerAuthHeader(baseUrl)
	});
	if (!response.ok) throw new Error(`peer status failed: ${response.status}`);
	return await response.json();
}
async function pagePeer(baseUrl, sessionId, request) {
	const response = await fetch(new URL("/v1/page", baseUrl), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...peerAuthHeader(baseUrl)
		},
		body: JSON.stringify({
			sessionId,
			request
		})
	});
	if (!response.ok) throw new Error(`peer page failed: ${response.status}`);
	return await response.json();
}
async function* followPeer(baseUrl, sessionId, request, signal) {
	const response = await fetch(new URL("/v1/follow", baseUrl), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...peerAuthHeader(baseUrl)
		},
		body: JSON.stringify({
			sessionId,
			request
		}),
		signal
	});
	if (!response.ok || response.body === null) throw new Error(`peer follow failed: ${response.status}`);
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		buffer += decoder.decode(chunk.value, { stream: true });
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line !== "") yield JSON.parse(line);
			newline = buffer.indexOf("\n");
		}
	}
}
async function searchPeer(baseUrl, query) {
	const response = await fetch(new URL("/v1/search", baseUrl), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...peerAuthHeader(baseUrl)
		},
		body: JSON.stringify({ query })
	});
	if (!response.ok) throw new Error(`peer search failed: ${response.status}`);
	return (await response.json()).items ?? [];
}
async function callPeer(baseUrl, method, sessionId, request) {
	const response = await fetch(new URL("/v1/session", baseUrl), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...peerAuthHeader(baseUrl)
		},
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
		headers: {
			"content-type": "application/json",
			...peerAuthHeader(baseUrl)
		},
		body: JSON.stringify({ sessionId })
	});
	if (!response.ok) {
		const body = await response.json().catch(() => void 0);
		const message = typeof body?.error === "string" ? body.error : `peer cancel failed: ${response.status}`;
		throw new Error(message);
	}
	return await response.json();
}
async function approvalsPeer(baseUrl) {
	const response = await fetch(new URL("/v1/approvals", baseUrl), {
		method: "POST",
		headers: peerAuthHeader(baseUrl)
	});
	if (!response.ok) throw new Error(`peer approvals failed: ${response.status}`);
	return (await response.json()).items ?? [];
}
async function answerPeer(baseUrl, sessionId, outcome) {
	const response = await fetch(new URL("/v1/approval", baseUrl), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...peerAuthHeader(baseUrl)
		},
		body: JSON.stringify({
			sessionId,
			outcome
		})
	});
	if (!response.ok) throw new Error(`peer approval failed: ${response.status}`);
	return await response.json();
}
async function promptPeer(baseUrl, sessionId, text) {
	const response = await fetch(new URL("/v1/prompt", baseUrl), {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...peerAuthHeader(baseUrl)
		},
		body: JSON.stringify({
			sessionId,
			text
		})
	});
	if (!response.ok) throw new Error(`peer prompt failed: ${response.status}`);
	return await response.json();
}
/** 对方插件调用它所在的那台 DSH。没有会话服务时列表为空，送消息会失败。 */
function sessionsFromHost(ctx, desk) {
	const face = (typeof ctx.get === "function" ? ctx.get("sessionController") : void 0) ?? ctx.sessionController;
	const list = face !== void 0 && typeof face.list === "function" ? face.list.bind(face) : void 0;
	const prompt = face !== void 0 && typeof face.prompt === "function" ? face.prompt.bind(face) : void 0;
	const cancel = face !== void 0 && typeof face.cancel === "function" ? face.cancel.bind(face) : void 0;
	const projections = face !== void 0 && typeof face.projections === "function" ? face.projections.bind(face) : void 0;
	const rename = face !== void 0 && typeof face.rename === "function" ? face.rename.bind(face) : void 0;
	const updateQueue = face !== void 0 && typeof face.updateQueue === "function" ? face.updateQueue.bind(face) : void 0;
	const selectModel = face !== void 0 && typeof face.selectModel === "function" ? face.selectModel.bind(face) : void 0;
	const fork = face !== void 0 && typeof face.fork === "function" ? face.fork.bind(face) : void 0;
	const attachment = face !== void 0 && typeof face.attachment === "function" ? face.attachment.bind(face) : void 0;
	const search = face !== void 0 && typeof face.search === "function" ? face.search.bind(face) : void 0;
	const follow = face !== void 0 && typeof face.follow === "function" ? face.follow.bind(face) : void 0;
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
		async *follow(sessionId, request, signal) {
			if (follow === void 0) throw new Error("这台 DSH 没有跟随接口");
			yield* follow({
				...request,
				address: {
					kind: "session",
					sessionId
				}
			}, signal);
		},
		async call(method, sessionId, request) {
			const target = method === "projections" ? projections : method === "rename" ? rename : method === "updateQueue" ? updateQueue : method === "selectModel" ? selectModel : method === "fork" ? fork : attachment;
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
		},
		async search(query) {
			if (search === void 0) return [];
			return ((await search({ query }, new AbortController().signal)).items ?? []).flatMap((item) => {
				if (typeof item.sessionId !== "string" || typeof item.snippet !== "string") return [];
				return [{
					sessionId: item.sessionId,
					snippet: item.snippet
				}];
			});
		},
		async approvals() {
			return desk?.list() ?? [];
		},
		async answer(sessionId, outcome) {
			if (desk === void 0 || !desk.answer(sessionId, outcome)) throw new Error("没有等待中的审批");
			return { accepted: true };
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
		cwd: machineGroupPath(peer),
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
async function* followRemote(sessionId, request, signal) {
	const remote = parseRemoteSessionId(sessionId);
	if (remote === void 0) return;
	for await (const frame of followPeer(remote.peer, remote.sessionId, request, signal)) {
		const encoded = JSON.stringify(frame).split(remote.sessionId).join(sessionId);
		yield JSON.parse(encoded);
	}
}
async function attachmentRemote(sessionId, request) {
	const remote = parseRemoteSessionId(sessionId);
	if (remote === void 0) return void 0;
	const value = await callPeer(remote.peer, "attachment", remote.sessionId, request);
	const encoded = JSON.stringify(value).split(remote.sessionId).join(sessionId);
	return JSON.parse(encoded);
}
async function forkRemote(sessionId, request) {
	const remote = parseRemoteSessionId(sessionId);
	if (remote === void 0) return void 0;
	const value = await callPeer(remote.peer, "fork", remote.sessionId, request);
	if (typeof value.sessionId !== "string") return value;
	return {
		...value,
		sessionId: remoteSessionId(remote.peer, value.sessionId)
	};
}
async function searchWithPeers(local, peers, query) {
	const items = [...local.items ?? []];
	const seen = new Set(items.flatMap((item) => typeof item.sessionId === "string" ? [item.sessionId] : []));
	for (const peer of peers) {
		let hits = [];
		try {
			hits = await searchPeer(peer, query);
		} catch {
			continue;
		}
		for (const hit of hits) {
			if (hit.sessionId.startsWith("ahoy:")) continue;
			const sessionId = remoteSessionId(peer, hit.sessionId);
			if (seen.has(sessionId)) continue;
			seen.add(sessionId);
			items.push({
				sessionId,
				snippet: hit.snippet
			});
		}
	}
	return {
		...local,
		items
	};
}
async function modelRemote(sessionId, request) {
	const remote = parseRemoteSessionId(sessionId);
	if (remote === void 0) return void 0;
	const value = await callPeer(remote.peer, "selectModel", remote.sessionId, request);
	const encoded = JSON.stringify(value).split(remote.sessionId).join(sessionId);
	return JSON.parse(encoded);
}
async function queueRemote(sessionId, request) {
	const remote = parseRemoteSessionId(sessionId);
	if (remote === void 0) return void 0;
	const value = await callPeer(remote.peer, "updateQueue", remote.sessionId, request);
	const encoded = JSON.stringify(value).split(remote.sessionId).join(sessionId);
	return JSON.parse(encoded);
}
async function renameRemote(sessionId, title) {
	const remote = parseRemoteSessionId(sessionId);
	if (remote === void 0) return void 0;
	const value = await callPeer(remote.peer, "rename", remote.sessionId, { title });
	const encoded = JSON.stringify(value).split(remote.sessionId).join(sessionId);
	return JSON.parse(encoded);
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
export { startPeer as S, approvalsPeer as _, listWithPeers as a, readPeer as b, parseRemoteSessionId as c, queueRemote as d, remoteListItem as f, answerPeer as g, acceptPeer as h, forkRemote as i, projectionRemote as l, searchWithPeers as m, cancelRemote as n, modelRemote as o, renameRemote as p, followRemote as r, pageRemote as s, attachmentRemote as t, promptRemote as u, pagePeer as v, sessionsFromHost as x, promptPeer as y };

//# sourceMappingURL=attach-DS73-FCy.js.map