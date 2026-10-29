import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// src/peers.ts
const peerTokens = /* @__PURE__ */ new Map();
/** 记下配对文件里的令牌。撤销就是换成另一枚，旧请求会被拒绝。 */
function setPeerToken(url, token) {
	if (token === void 0 || token === "") peerTokens.delete(url);
	else peerTokens.set(url, token);
}
function peerAuthHeader(url) {
	const token = peerTokens.get(url);
	return token === void 0 ? {} : { "x-ahoy-token": token };
}
/** 环境变量优先。桌面应用没有这个环境变量时，读 profile 目录里的 ahoy-peers.json。 */
function peerRefs(envValue, fileText) {
	const fromEnv = (envValue ?? "").split(",").map((item) => item.trim()).filter((item) => item !== "");
	if (fromEnv.length > 0) return fromEnv.map((url) => ({ url }));
	if (fileText === void 0 || fileText.trim() === "") return [];
	try {
		const parsed = JSON.parse(fileText);
		if (!Array.isArray(parsed.peers)) return [];
		return parsed.peers.flatMap((item) => {
			if (typeof item === "string" && item.trim() !== "") return [{ url: item.trim() }];
			if (item !== null && typeof item === "object" && "url" in item && typeof item.url === "string" && item.url.trim() !== "") {
				const token = "token" in item && typeof item.token === "string" ? item.token : void 0;
				const expiresAt = "expiresAt" in item && typeof item.expiresAt === "number" ? item.expiresAt : void 0;
				return [{
					url: item.url.trim(),
					...token !== void 0 ? { token } : {},
					...expiresAt !== void 0 ? { expiresAt } : {}
				}];
			}
			return [];
		});
	} catch {
		return [];
	}
}
function activePeers(peers, now) {
	return peers.filter((peer) => peer.expiresAt === void 0 || peer.expiresAt > now);
}
function peerUrls(envValue, fileText, now = Date.now()) {
	return activePeers(peerRefs(envValue, fileText), now).map((peer) => peer.url);
}
/** 环境变量优先。内容可以是端口，或 `虚拟地址:端口`。 */
function listenEndpoint(envValue, fileText) {
	const source = envValue !== void 0 && envValue.trim() !== "" ? envValue : fileText;
	if (source === void 0 || source.trim() === "") return void 0;
	const trimmed = source.trim();
	const colon = trimmed.lastIndexOf(":");
	if (colon > 0 && !trimmed.includes("://")) {
		const host = trimmed.slice(0, colon);
		const port = Number(trimmed.slice(colon + 1));
		if (host !== "" && Number.isInteger(port) && port >= 0 && port <= 65535) return {
			host,
			port
		};
		return;
	}
	const port = Number(trimmed);
	if (!Number.isInteger(port) || port < 0 || port > 65535) return void 0;
	return {
		host: "127.0.0.1",
		port
	};
}
function listenPort(envValue, fileText) {
	return listenEndpoint(envValue, fileText)?.port;
}
function upsertPeer(fileText, peer) {
	const peers = peerRefs(void 0, fileText).filter((item) => item.url !== peer.url);
	peers.push(peer);
	return `${JSON.stringify({ peers }, null, 2)}\n`;
}
function savePeerRef(peer, env = process.env, argv = process.argv, stack = (/* @__PURE__ */ new Error()).stack) {
	const path = peerConfigPath(env.DSH_PROFILE_DIR || profileDirFromArgv(argv, env.DSH_HOME) || profileDirFromStack(stack));
	if (path === void 0) throw new Error("这台机器没有 profile 目录");
	let fileText;
	try {
		fileText = readFileSync(path, "utf8");
	} catch {
		fileText = void 0;
	}
	writeFileSync(path, upsertPeer(fileText, peer));
	setPeerToken(peer.url, peer.token);
}
function peerConfigPath(profileDir) {
	if (profileDir === void 0 || profileDir === "") return void 0;
	return join(profileDir, "ahoy-peers.json");
}
/** DSH 用 `file://<profile>/#dsh-ahoy` 调用插件。环境变量还没写上时，从这层调用栈认出 profile。 */
function profileDirFromStack(stack) {
	if (stack === void 0) return void 0;
	const found = stack.match(/file:\/\/(\/[^)\s]+)\/#dsh-ahoy\b/)?.[1];
	if (found === void 0) return void 0;
	try {
		return decodeURIComponent(found);
	} catch {
		return;
	}
}
function profileDirFromArgv(argv, home) {
	if (home !== void 0 && home !== "") {
		const index = argv.indexOf("--profile");
		const name = index >= 0 ? argv[index + 1] : void 0;
		if (name !== void 0 && name !== "" && !name.startsWith("-")) return join(home, "profiles", name);
	}
	return argv.find((arg) => /\/\.dsh\/profiles\/[^/]+$/.test(arg));
}
function loadPeerUrls(env = process.env, argv = process.argv, stack = (/* @__PURE__ */ new Error()).stack) {
	const path = peerConfigPath(env.DSH_PROFILE_DIR || profileDirFromArgv(argv, env.DSH_HOME) || profileDirFromStack(stack));
	let fileText;
	if (path !== void 0) try {
		fileText = readFileSync(path, "utf8");
	} catch {
		fileText = void 0;
	}
	const refs = activePeers(peerRefs(env.DSH_AHOY_PEERS, fileText), Date.now());
	for (const peer of refs) setPeerToken(peer.url, peer.token);
	return refs.map((peer) => peer.url);
}
function loadListenEndpoint(env = process.env, argv = process.argv, stack = (/* @__PURE__ */ new Error()).stack) {
	const peersFile = peerConfigPath(env.DSH_PROFILE_DIR || profileDirFromArgv(argv, env.DSH_HOME) || profileDirFromStack(stack));
	const file = peersFile === void 0 ? void 0 : join(peersFile, "..", "ahoy-listen");
	let fileText;
	if (file !== void 0) try {
		fileText = readFileSync(file, "utf8");
	} catch {
		fileText = void 0;
	}
	return listenEndpoint(env.DSH_AHOY_LISTEN, fileText);
}
function loadListenPort(env = process.env, argv = process.argv, stack = (/* @__PURE__ */ new Error()).stack) {
	return loadListenEndpoint(env, argv, stack)?.port;
}
export { activePeers, listenEndpoint, listenPort, loadListenEndpoint, loadListenPort, loadPeerUrls, peerAuthHeader, peerConfigPath, peerRefs, peerUrls, profileDirFromArgv, profileDirFromStack, savePeerRef, setPeerToken, upsertPeer };

//# sourceMappingURL=peers.js.map