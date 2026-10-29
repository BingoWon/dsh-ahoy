// src/index.ts
const name = "dsh-ahoy";
function apply(ctx) {
	ctx.effect(() => () => {}, "dsh-ahoy: ready");
}
export { apply, name };

//# sourceMappingURL=index.js.map