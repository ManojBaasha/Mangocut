const DEFAULT_ADMIN_EMAIL = "manoj.elango123@gmail.com";

export function getAdminEmail(): string {
	const raw = (
		process.env.NEXT_PUBLIC_MANGOCUT_ADMIN_EMAIL ||
		process.env.MANGOCUT_ADMIN_EMAIL ||
		""
	).trim();
	return raw || DEFAULT_ADMIN_EMAIL;
}

export function isAdminEmail({
	email,
}: {
	email: string | null | undefined;
}): boolean {
	if (!email || typeof email !== "string") return false;
	return email.trim().toLowerCase() === getAdminEmail().toLowerCase();
}
