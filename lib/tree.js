// src/tree.ts
/** 对方会话在官方会话树里使用的标识。前缀避免和本机会话撞车。 */
function remoteSessionId(peer, sessionId) {
	return `ahoy:${encodeURIComponent(peer)}:${sessionId}`;
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
export { framesForNewSessions, remoteSessionId };

//# sourceMappingURL=tree.js.map