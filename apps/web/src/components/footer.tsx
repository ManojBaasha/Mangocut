import Link from "next/link";
import Image from "next/image";
import { DEFAULT_LOGO_URL } from "@/lib/site/brand";
import { SOCIAL_LINKS } from "@/lib/site/social";
import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

type Category = "resources";

interface FooterLink {
	label: string;
	href: string;
}

type CategoryLinks = Record<Category, FooterLink[]>;

const links: CategoryLinks = {
	resources: [
		{ label: "Projects", href: "/projects" },
		{ label: "Changelog", href: "/changelog" },
		{ label: "Privacy", href: "/privacy" },
		{ label: "Terms of use", href: "/terms" },
	],
};

export function Footer() {
	return (
		<footer className="bg-background border-t">
			<div className="mx-auto max-w-5xl px-8 py-10">
				<div className="mb-8 grid grid-cols-1 gap-12 md:grid-cols-2">
					<div className="max-w-sm md:col-span-1">
						<div className="mb-4 flex items-center justify-start gap-2">
							<Image
								src={DEFAULT_LOGO_URL}
								alt="Mangocut"
								width={24}
								height={24}
							/>
							<span className="text-lg font-bold">Mangocut</span>
						</div>
						<p className="text-muted-foreground mb-5 text-sm md:text-left">
							Edit Videos with AI — cut, polish, and ship faster.
						</p>
						<div className="flex justify-start gap-3">
							<Link
								href={SOCIAL_LINKS.github}
								className="text-muted-foreground hover:text-foreground transition-colors"
								target="_blank"
								rel="noopener noreferrer"
							>
								<HugeiconsIcon icon={GithubIcon} className="size-5" />
							</Link>
						</div>
					</div>

					<div>
						{Object.entries(links).map(([category, categoryLinks]) => (
							<div key={category}>
								<h3 className="mb-3 text-sm font-semibold capitalize">
									{category}
								</h3>
								<ul className="space-y-2">
									{categoryLinks.map((link) => (
										<li key={link.href}>
											<Link
												href={link.href}
												className="text-muted-foreground hover:text-foreground text-sm transition-colors"
											>
												{link.label}
											</Link>
										</li>
									))}
								</ul>
							</div>
						))}
					</div>
				</div>

				<div className="flex flex-col items-start justify-between gap-4 pt-2 md:flex-row">
					<div className="text-muted-foreground flex items-center gap-4 text-sm">
						<span>
							© {new Date().getFullYear()} Mangocut, All Rights Reserved
						</span>
					</div>
				</div>
			</div>
		</footer>
	);
}
