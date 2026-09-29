export async function checkRateLimit(_args: { request: Request }) {
	return { success: true, limited: false };
}
