"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "./ui/button";
import { ThemeToggle } from "./theme-toggle";
import {
	Download01Icon,
	GithubIcon,
	LinkSquare02Icon,
	Menu02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/utils/ui";
import { DEFAULT_LOGO_URL } from "@/lib/site/brand";
import { SOCIAL_LINKS } from "@/lib/site/social";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "./ui/context-menu";

export function Header() {
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const closeMenu = () => setIsMenuOpen(false);

	const links = [
		{ label: "Projects", href: "/projects" },
		{ label: "Changelog", href: "/changelog" },
		{ label: "Privacy", href: "/privacy" },
		{ label: "Terms", href: "/terms" },
	];

	return (
		<header className="bg-background shadow-background/85 sticky top-0 z-10 shadow-[0_30px_35px_15px_rgba(0,0,0,1)]">
			<div className="relative flex w-full items-center justify-between px-6 pt-4">
				<div className="relative z-10 flex items-center gap-6">
					<ContextMenu>
						<ContextMenuTrigger asChild>
							<Link href="/projects" className="flex items-center gap-3">
								<Image
									src={DEFAULT_LOGO_URL}
									alt="Mangocut Logo"
									width={32}
									height={32}
								/>
							</Link>
						</ContextMenuTrigger>
						<ContextMenuContent>
							<ContextMenuItem
								onClick={async () => {
									const res = await fetch(DEFAULT_LOGO_URL);
									const svg = await res.text();
									await navigator.clipboard.writeText(svg);
								}}
							>
								Copy SVG
							</ContextMenuItem>
							<ContextMenuItem
								onClick={() => {
									const a = document.createElement("a");
									a.href = DEFAULT_LOGO_URL;
									a.download = "mangocut-logo.svg";
									a.click();
								}}
							>
								<HugeiconsIcon icon={Download01Icon} />
								Download SVG
							</ContextMenuItem>
							<ContextMenuItem asChild>
								<a href={DEFAULT_LOGO_URL} target="_blank" rel="noreferrer">
									<HugeiconsIcon icon={LinkSquare02Icon} />
									Open SVG
								</a>
							</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>

					<nav className="hidden items-center gap-6 md:flex">
						{links.map((link) => (
							<Link
								key={link.href}
								href={link.href}
								className="text-muted-foreground hover:text-foreground text-sm transition-colors"
							>
								{link.label}
							</Link>
						))}
					</nav>
				</div>

				<div className="relative z-10 flex items-center gap-2">
					<ThemeToggle />
					<Link href={SOCIAL_LINKS.github} className="hidden sm:inline-flex">
						<Button variant="ghost" size="icon">
							<HugeiconsIcon icon={GithubIcon} />
						</Button>
					</Link>
					<Button
						variant="ghost"
						size="icon"
						className="md:hidden"
						onClick={() => setIsMenuOpen((open) => !open)}
					>
						<HugeiconsIcon icon={Menu02Icon} />
					</Button>
				</div>
			</div>

			<div
				className={cn(
					"bg-background absolute top-full right-0 left-0 z-0 flex flex-col gap-2 border-b px-6 py-4 md:hidden",
					!isMenuOpen && "hidden",
				)}
			>
				{links.map((link) => (
					<Link
						key={link.href}
						href={link.href}
						onClick={closeMenu}
						className="text-muted-foreground hover:text-foreground py-1 text-sm"
					>
						{link.label}
					</Link>
				))}
			</div>
		</header>
	);
}
