import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { isAdminEmail } from "@/lib/auth/admin";
import { AdminDashboard } from "./admin-dashboard";

export default async function AdminPage() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!isAdminEmail({ email: session?.user?.email })) {
		notFound();
	}
	return <AdminDashboard />;
}
