const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/** Return a safe HTTP(S) target for OSC 8, or null when the target is unsafe. */
export function safePrUrl(value) {
	if (typeof value !== "string" || !value || CONTROL_CHARACTERS.test(value)) return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
	} catch {
		return null;
	}
}

/** Render an open-PR footer segment, linking only a safe target. */
export function renderPrSegment(pr, theme, bracket, hyperlink) {
	if (!pr) return "";
	const text = theme.fg("accent", `#${pr.number}`);
	const url = safePrUrl(pr.url);
	return bracket(theme, url ? hyperlink(text, url) : text);
}
