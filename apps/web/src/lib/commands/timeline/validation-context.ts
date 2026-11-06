/**
 * Whether timeline edits must pass the Rust engine's result validation
 * (no new overlap / invalid trim or duration, else `invalid_result`).
 *
 * The editor UI stays permissive, like the TS commands before the Rust port
 * (e.g. slowing a clip may overlap the next one). Agent paths run their
 * edits inside `withStrictTimelineValidation` so a bad edit is reported
 * back instead of silently corrupting the timeline.
 */
let strictDepth = 0;

export function withStrictTimelineValidation<T>(run: () => T): T {
	strictDepth += 1;
	try {
		return run();
	} finally {
		strictDepth -= 1;
	}
}

export function isStrictTimelineValidation(): boolean {
	return strictDepth > 0;
}
