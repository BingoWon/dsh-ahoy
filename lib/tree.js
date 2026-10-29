// src/tree.ts
/** 对方会话在官方会话树里使用的标识。前缀避免和本机会话撞车。 */
function remoteSessionId(peer, sessionId) {
	return `ahoy:${encodeURIComponent(peer)}:${sessionId}`;
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
export { formatBytes, framesForNewSessions, remoteSessionId };

//# sourceMappingURL=tree.js.map