"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ensureAiBearerFromCloud, setStoredAiBearer } from "@/lib/ai/cloud-fetch";
import { isAllowedDesktopOrigin } from "@/lib/ai/ai-cors";

function BridgeInner() {
	const params = useSearchParams();
	const [status, setStatus] = useState<"working" | "ok" | "error">("working");
	const [detail, setDetail] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			try {
				const returnTo = params.get("return_to");
				if (!returnTo) {
					setStatus("error");
					setDetail("Missing return_to parameter.");
					return;
				}
				let returnUrl: URL;
				try {
					returnUrl = new URL(returnTo);
				} catch {
					setStatus("error");
					setDetail("Invalid return_to URL.");
					return;
				}
				if (!isAllowedDesktopOrigin({ origin: returnUrl.origin })) {
					setStatus("error");
					setDetail("return_to origin is not allowed.");
					return;
				}

				const token = await ensureAiBearerFromCloud();
				if (!token) {
					setStatus("error");
					setDetail("Sign in on this host first, then retry.");
					return;
				}
				setStoredAiBearer({ token });
				returnUrl.searchParams.set("token", token);
				setStatus("ok");
				window.location.replace(returnUrl.toString());
			} catch {
				setStatus("error");
				setDetail("Could not create an AI session.");
			}
		})();
	}, [params]);

	return (
		<main className="bg-background flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
			<p className="text-sm font-medium">Connecting Mangocut AI session…</p>
			{status === "ok" ? (
				<p className="text-muted-foreground text-xs">Redirecting back to the app…</p>
			) : null}
			{status === "error" ? (
				<>
					<p className="text-destructive text-xs">{detail}</p>
					<Button size="sm" onClick={() => window.location.reload()}>
						Retry
					</Button>
				</>
			) : null}
		</main>
	);
}

export default function DesktopAuthBridgePage() {
	return (
		<Suspense
			fallback={
				<main className="bg-background flex min-h-screen items-center justify-center p-6 text-sm">
					Connecting…
				</main>
			}
		>
			<BridgeInner />
		</Suspense>
	);
}
