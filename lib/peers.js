import { readFileSync } from "node:fs";
import { join } from "node:path";
// src/peers.ts
/** 环境变量优先。桌面应用没有这个环境变量时，读 profile 目录里的 ahoy-peers.json。 */
function peerUrls(envValue, fileText) {
	const fromEnv = (envValue ?? "").split(",").map((item) => item.trim()).filter((item) => item !== "");
	if (fromEnv.length > 0) return fromEnv;
	if (fileText === void 0 || fileText.trim() === "") return [];
	try {
		const parsed = JSON.parse(fileText);
		if (!Array.isArray(parsed.peers)) return [];
		return parsed.peers.flatMap((item) => typeof item === "string" && item.trim() !== "" ? [item.trim()] : []);
	} catch {
		return [];
	}
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
	return peerUrls(env.DSH_AHOY_PEERS, fileText);
}
export { loadPeerUrls, peerConfigPath, peerUrls, profileDirFromArgv, profileDirFromStack };

//# sourceMappingURL=peers.js.map