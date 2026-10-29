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
	return {
		async list() {
			if (face === void 0 || typeof face.list !== "function") return [];
			return ((await face.list({}, new AbortController().signal)).items ?? []).flatMap((item) => {
				if (typeof item.sessionId !== "string") return [];
				return [{
					sessionId: item.sessionId,
					title: typeof item.title === "string" ? item.title : item.sessionId
				}];
			});
		},
		async prompt(sessionId, text) {
			if (face === void 0 || typeof face.prompt !== "function") throw new Error("这台 DSH 没有会话接口");
			await face.prompt({
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
		peer: {
			type: "string",
			description: "对方插件的地址，例如 http://127.0.0.1:47321",
			required: true
		},
		text: {
			type: "string",
			description: "要交给对方的话",
			required: true
		},
		sessionId: {
			type: "string",
			description: "对方已有会话。省略时使用对方列表里的第一场会话。"
		}
	},
	async execute(args) {
		if (typeof args.peer !== "string" || typeof args.text !== "string") throw new Error("ahoy 需要 peer 和 text");
		return delegateToPeer({
			peer: args.peer,
			text: args.text,
			sessionId: args.sessionId
		});
	}
};
// src/index.ts
/**
* dsh-ahoy 宿主插件。
*
* 两个 profile 用 127.0.0.1 直接互连。DSH_AHOY_LISTEN 是本机监听端口。
* 不要加转发进程，也不要走 SSH。
*/
const name = "dsh-ahoy";
function apply(ctx) {
	const listen = process.env.DSH_AHOY_LISTEN;
	let closePeer;
	let stopped = false;
	if (listen !== void 0 && listen !== "") {
		const port = Number(listen);
		if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`DSH_AHOY_LISTEN 不是端口: ${listen}`);
		startPeer(port, sessionsFromHost(ctx)).then((handle) => {
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
export { apply, delegateToPeer, name, promptPeer, readPeer, sessionsFromHost, startPeer };

//# sourceMappingURL=index.js.map