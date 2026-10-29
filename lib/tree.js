// src/tree.ts
/** 对方会话在官方会话树里使用的标识。前缀避免和本机会话撞车。 */
function remoteSessionId(peer, sessionId) {
	return `ahoy:${encodeURIComponent(peer)}:${sessionId}`;
}
/** 官方会话树用路径的最后一段当分组标题。 */
/** 官方新建会话如果带了这台机器的分组路径，就改由对方创建。 */
function peerForGroup(cwd, peers) {
	if (cwd === void 0 || !cwd.startsWith("ahoy/")) return void 0;
	const host = cwd.slice(5);
	return peers.find((peer) => {
		try {
			return new URL(peer).host === host;
		} catch {
			return false;
		}
	});
}
function machineGroupPath(peer) {
	try {
		const host = new URL(peer).host;
		return `ahoy/${host !== "" ? host : peer}`;
	} catch {
		return `ahoy/${peer}`;
	}
}
/** 只留下对方标明当前能跑的模型。目录没给出可路由的供应商时，不把名字当成能跑。 */
function usableModels(catalog) {
	if (catalog === null || typeof catalog !== "object") return [];
	const record = catalog;
	const routable = Array.isArray(record.routableProviders) ? record.routableProviders.filter((item) => typeof item === "string") : [];
	if (!Array.isArray(record.groups) || routable.length === 0) return [];
	const allowed = new Set(routable);
	const models = [];
	for (const group of record.groups) {
		if (group === null || typeof group !== "object") continue;
		const provider = group.id;
		if (typeof provider !== "string" || !allowed.has(provider)) continue;
		const listed = group.models;
		if (!Array.isArray(listed)) continue;
		for (const model of listed) {
			if (model === null || typeof model !== "object") continue;
			const id = model.id;
			if (typeof id !== "string") continue;
			const name = model.name;
			models.push({
				provider,
				id,
				name: typeof name === "string" && name !== "" ? name : id
			});
		}
	}
	return models;
}
/** 对方这次没连上时，沿用上次的会话列表，并标明这不是现在的状态。 */
function cardAfterFetch(cache, peer, next, now) {
	if (next.error === void 0) {
		cache.set(peer, {
			...next,
			seenAt: now
		});
		return next;
	}
	const previous = cache.get(peer);
	if (previous === void 0) return next;
	return {
		...previous,
		peer,
		error: "这是缓存，不是现在"
	};
}
/** 把字节数收成卡片上的短数字。空值保持破折号，不假装读到了 0。 */
function formatBytes(value) {
	if (value === null || !Number.isFinite(value) || value < 0) return "—";
	const units = [
		"B",
		"KB",
		"MB",
		"GB",
		"TB"
	];
	let size = value;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	const digits = unit === 0 || size >= 10 ? 0 : 1;
	return `${size.toFixed(digits)} ${units[unit]}`;
}
/** 只为还没宣布过的对方会话产生官方树帧。 */
function framesForNewSessions(seen, sessions) {
	const frames = [];
	for (const session of sessions) {
		const sessionId = remoteSessionId(session.peer, session.sessionId);
		if (seen.has(sessionId)) continue;
		seen.add(sessionId);
		frames.push({
			type: "host/session-added",
			sessionId,
			blank: false
		});
		frames.push({
			type: "session/projection",
			sessionId,
			key: "title",
			value: session.title,
			seq: 0
		});
	}
	return frames;
}
export { cardAfterFetch, formatBytes, framesForNewSessions, machineGroupPath, peerForGroup, remoteSessionId, usableModels };

//# sourceMappingURL=tree.js.map