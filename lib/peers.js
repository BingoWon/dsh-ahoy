import { readFileSync } from "node:fs";
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
				return [{
					url: item.url.trim(),
					token
				}];
			}
			return [];
		});
	} catch {
		return [];
	}
}
function peerUrls(envValue, fileText) {
	return peerRefs(envValue, fileText).map((peer) => peer.url);
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
	if (home === void 0 || home === "") return void 0;
	const index = argv.indexOf("--profile");
	const name = index >= 0 ? argv[index + 1] : void 0;
	if (name === void 0 || name === "" || name.startsWith("-")) return void 0;
	return join(home, "profiles", name);
}
function loadPeerUrls(env = process.env, argv = process.argv, stack = (/* @__PURE__ */ new Error()).stack) {
	const path = peerConfigPath(env.DSH_PROFILE_DIR || profileDirFromArgv(argv, env.DSH_HOME) || profileDirFromStack(stack));
	let fileText;
	if (path !== void 0) try {
		fileText = readFileSync(path, "utf8");
	} catch {
		fileText = void 0;
	}
	const refs = peerRefs(env.DSH_AHOY_PEERS, fileText);
	for (const peer of refs) setPeerToken(peer.url, peer.token);
	return refs.map((peer) => peer.url);
}
export { loadPeerUrls, peerAuthHeader, peerConfigPath, peerRefs, peerUrls, profileDirFromArgv, profileDirFromStack, setPeerToken };

//# sourceMappingURL=peers.js.map