import assert from "node:assert/strict";
import test from "node:test";
import { registerCopyDraftShortcut } from "../copy-draft.mjs";

function register(text, copyText) {
	let registration;
	const notices = [];
	registerCopyDraftShortcut(
		{
			registerShortcut(shortcut, options) {
				registration = { shortcut, ...options };
			},
		},
		copyText,
	);

	assert.ok(registration);
	return {
		registration,
		notices,
		ctx: {
			ui: {
				getEditorText: () => text,
				notify: (message, level) => notices.push({ message, level }),
			},
		},
	};
}

test("registers Alt+C and awaits copying the exact logical draft", async () => {
	const copied = [];
	let finishCopy;
	const copyPending = new Promise((resolve) => {
		finishCopy = resolve;
	});
	const { ctx, notices, registration } = register("first line\nsecond line", async (text) => {
		copied.push(text);
		await copyPending;
	});

	assert.equal(registration.shortcut, "alt+c");
	const handling = registration.handler(ctx);
	assert.deepEqual(copied, ["first line\nsecond line"]);
	assert.deepEqual(notices, []);

	finishCopy();
	await handling;
	assert.deepEqual(notices, [{ message: "Copied 22 chars from editor", level: "info" }]);
});

test("reports an empty editor without invoking the clipboard", async () => {
	let copyCalls = 0;
	const { ctx, notices, registration } = register("", async () => {
		copyCalls += 1;
	});

	await registration.handler(ctx);
	assert.equal(copyCalls, 0);
	assert.deepEqual(notices, [{ message: "Editor is empty", level: "info" }]);
});

test("reports clipboard failures without claiming success", async () => {
	const { ctx, notices, registration } = register("draft", async () => {
		throw new Error("clipboard unavailable");
	});

	await registration.handler(ctx);
	assert.deepEqual(notices, [{ message: "Could not copy the editor draft", level: "error" }]);
});
