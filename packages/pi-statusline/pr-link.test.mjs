import assert from "node:assert/strict";
import test from "node:test";
import { renderPrSegment, safePrUrl } from "./pr-link.mjs";

test("safePrUrl accepts ordinary GitHub and GitHub Enterprise HTTP(S) URLs", () => {
	assert.equal(safePrUrl("https://github.com/smarzban/pi-extensions/pull/31"), "https://github.com/smarzban/pi-extensions/pull/31");
	assert.equal(safePrUrl("http://github.example.test/owner/repo/pull/31"), "http://github.example.test/owner/repo/pull/31");
});

test("safePrUrl rejects non-HTTP(S) URLs and terminal controls", () => {
	assert.equal(safePrUrl("file:///tmp/pr"), null);
	assert.equal(safePrUrl("javascript:alert(1)"), null);
	assert.equal(safePrUrl("https://github.com/pull/31\u001b]8;;https://evil.example\u001b\\"), null);
});

test("renderPrSegment always calls the hyperlink renderer for a safe PR URL", () => {
	const calls = [];
	const theme = { fg: (_color, text) => `<accent>${text}</accent>` };
	const bracket = (_theme, text) => `[${text}]`;
	const hyperlink = (text, url) => {
		calls.push({ text, url });
		return `\u001b]8;;${url}\u001b\\${text}\u001b]8;;\u001b\\`;
	};
	const segment = renderPrSegment({ number: 31, url: "https://github.com/smarzban/pi-extensions/pull/31" }, theme, bracket, hyperlink);
	assert.deepEqual(calls, [{ text: "<accent>#31</accent>", url: "https://github.com/smarzban/pi-extensions/pull/31" }]);
	assert.match(segment, /^\[\u001b]8;;https:\/\/github\.com\/smarzban\/pi-extensions\/pull\/31/);
});

test("renderPrSegment leaves an unsafe PR URL as plain footer text", () => {
	let linked = false;
	const theme = { fg: (_color, text) => text };
	const segment = renderPrSegment(
		{ number: 31, url: "https://github.com/pull/31\u001b]8;;https://evil.example\u001b\\" },
		theme,
		(_theme, text) => `[${text}]`,
		() => {
			linked = true;
			return "unexpected";
		},
	);
	assert.equal(segment, "[#31]");
	assert.equal(linked, false);
});
