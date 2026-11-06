"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setStoredAiBearer } from "@/lib/ai/cloud-fetch";

function CompleteInner() {
	const params = useSearchParams();
	const router = useRouter();

	useEffect(() => {
		const token = params.get("token");
		if (token) {
			setStoredAiBearer({ token });
		}
		router.replace("/projects");
	}, [params, router]);

	return (
		<main className="bg-background flex min-h-screen items-center justify-center p-6 text-sm">
			AI session connected. Returning to projects…
		</main>
	);
}

/** Local desktop landing page after cloud bridge redirect. */
export default function DesktopBridgeCompletePage() {
	return (
		<Suspense fallback={<main className="p-6 text-sm">Connecting…</main>}>
			<CompleteInner />
		</Suspense>
	);
}
