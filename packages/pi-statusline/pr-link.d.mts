export interface PullRequestLink {
	number: number;
	url: string;
}

export interface StatuslineTheme {
	fg(color: string, text: string): string;
}

export function safePrUrl(value: unknown): string | null;

export function renderPrSegment(
	pr: PullRequestLink | null,
	theme: StatuslineTheme,
	bracket: (theme: StatuslineTheme, text: string) => string,
	hyperlink: (text: string, url: string) => string,
): string;
