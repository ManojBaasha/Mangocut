"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { isMangocutDesktop } from "@/lib/ai/desktop";

const STORAGE_KEY = "mangocut-web-capability-banner-dismissed";

export function WebCapabilityBanner() {
	const [show, setShow] = useState(false);

	useEffect(() => {
		if (isMangocutDesktop()) {
			setShow(false);
			return;
		}
		try {
			setShow(window.localStorage.getItem(STORAGE_KEY) !== "true");
		} catch {
			setShow(true);
		}
	}, []);

	if (!show) return null;

	return (
		<div className="bg-accent/60 text-foreground flex items-start justify-between gap-3 border-b px-4 py-2 text-xs leading-relaxed">
			<p>
				Projects and media stay in this browser — nothing syncs to the cloud.
				Folder import and some AI tools need the Mangocut desktop app.
			</p>
			<Button
				size="sm"
				variant="ghost"
				className="h-7 shrink-0 text-xs"
				onClick={() => {
					try {
						window.localStorage.setItem(STORAGE_KEY, "true");
					} catch {
						// ignore
					}
					setShow(false);
				}}
			>
				Dismiss
			</Button>
		</div>
	);
}
