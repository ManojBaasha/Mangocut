import type { Metadata } from "next";
import { BasePage } from "@/app/base-page";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { SOCIAL_LINKS } from "@/lib/site/social";

export const metadata: Metadata = {
	title: "Terms of Service - Mangocut",
	description:
		"Mangocut's Terms of Service. Fair, transparent terms for our AI video editor.",
	openGraph: {
		title: "Terms of Service - Mangocut",
		description:
			"Mangocut's Terms of Service. Fair, transparent terms for our AI video editor.",
		type: "website",
	},
};

export default function TermsPage() {
	return (
		<BasePage
			title="Terms of service"
			description="Fair and transparent terms for our AI video editor. Contact us if you have any questions."
		>
			<Accordion type="single" collapsible className="w-full">
				<AccordionItem
					value="quick-summary"
					className="rounded-2xl border px-5"
				>
					<AccordionTrigger className="no-underline!">
						Quick summary
					</AccordionTrigger>
					<AccordionContent>
						<h3 className="mb-3 text-lg font-medium">
							You own your content. Use Mangocut responsibly.
						</h3>
						<ol className="list-decimal space-y-2 pl-6">
							<li>
								You retain ownership of the videos and projects you create
							</li>
							<li>
								Core editing stays on your device; cloud AI is optional and
								subject to fair-use / trial limits
							</li>
							<li>
								Google sign-in is optional and used for account and AI
								entitlement features
							</li>
							<li>
								Don’t use Mangocut for illegal, harmful, or abusive activity
							</li>
							<li>
								The service is provided “as is” — we can’t guarantee perfect
								uptime or AI accuracy
							</li>
							<li>
								Open-source components may be reviewed and self-hosted under
								their licenses
							</li>
						</ol>
						<p className="mt-4">
							Questions? Email us at{" "}
							<a
								href="mailto:oss@mangocut.app"
								className="text-primary hover:underline"
							>
								oss@mangocut.app
							</a>
						</p>
					</AccordionContent>
				</AccordionItem>
			</Accordion>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Agreement</h2>
				<p>
					By using Mangocut (including{" "}
					<a
						href="https://mangocut.jonam.dev"
						className="text-primary hover:underline"
					>
						mangocut.jonam.dev
					</a>
					, the web editor, and the desktop app), you agree to these Terms of
					Service and our{" "}
					<a href="/privacy" className="text-primary hover:underline">
						Privacy Policy
					</a>
					.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Your content, your rights</h2>
				<p>
					<strong>You own everything you create.</strong> We make no claim to
					ownership over your videos, projects, media, or exports. You are
					responsible for having the rights to any media you import and for how
					you use your finished work.
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>You retain intellectual property rights to your content</li>
					<li>You can export and use your content for personal or commercial purposes</li>
					<li>Mangocut does not add ownership watermarks to your exports</li>
				</ul>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Accounts &amp; Google sign-in</h2>
				<p>
					Some features—especially AI trial entitlements—may require or offer
					Google sign-in. You must have the right to use the Google account you
					connect, and you must provide accurate account information.
				</p>
				<p>
					You are responsible for activity under your signed-in session. If you
					believe your account access was compromised, sign out and contact us.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">AI features</h2>
				<p>
					Mangocut provides optional AI-assisted editing tools. Some run on your
					device (for example local transcription). Others use cloud models:
					when you use those features, prompts and related context you provide
					may be sent to our AI providers to generate a response.
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>AI output can be wrong, incomplete, or unexpected—review edits before you rely on them</li>
					<li>AI features may be rate-limited or offered as a free trial</li>
					<li>We may change models, limits, or availability as the product evolves</li>
					<li>Do not use AI features to generate or distribute illegal or abusive content</li>
				</ul>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Acceptable use</h2>
				<p>You agree not to:</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>Violate applicable laws or others’ rights</li>
					<li>Attempt to bypass usage limits, authentication, or security controls</li>
					<li>Abuse, overload, or disrupt Mangocut infrastructure or AI providers</li>
					<li>Misrepresent your identity when signing in</li>
					<li>Upload or process malware or content you do not have rights to use</li>
				</ul>
				<p>
					We may suspend or limit access if we reasonably believe these terms
					are being violated.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">How you can use Mangocut</h2>
				<p>
					Subject to these terms, Mangocut is available for personal and
					commercial creative work. You may:
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>Create videos for personal, educational, or commercial purposes</li>
					<li>Use Mangocut for client work and paid projects</li>
					<li>Share and distribute videos you create with Mangocut</li>
					<li>
						Use and modify open-source Mangocut software under its applicable
						license (for example MIT where that license applies)
					</li>
				</ul>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Service availability</h2>
				<p>
					Mangocut is provided “as is” and “as available” without warranties of
					any kind to the fullest extent permitted by law. We do not guarantee
					uninterrupted service, perfect AI results, or that local browser
					storage will never be lost.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Open source</h2>
				<p>
					Parts of Mangocut are open source. Review the code and license on{" "}
					<a
						href={SOCIAL_LINKS.github}
						target="_blank"
						rel="noopener"
						className="text-primary hover:underline"
					>
						GitHub
					</a>
					. Self-hosting or modifying the software is subject to the relevant
					license terms and does not create a support obligation for us.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Limitations of liability</h2>
				<p>To the extent permitted by law:</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>We are not liable for loss of local projects, media, or exports</li>
					<li>
						Projects stored in your browser or on your machine may be lost if
						you clear data, reinstall, or experience device failure
					</li>
					<li>We are not responsible for how you use the service or AI output</li>
					<li>Our aggregate liability is limited to the maximum extent allowed by law</li>
				</ul>
				<p>
					Export important work when you finish editing. We cannot recover local
					projects from your device.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Changes</h2>
				<p>We may update Mangocut and these terms:</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>Material changes will be reflected by updating the date below</li>
					<li>Continued use after changes means you accept the updated terms</li>
					<li>You can stop using the service if you do not agree</li>
				</ul>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Stopping use</h2>
				<p>You can stop using Mangocut at any time:</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>Sign out of Google authentication</li>
					<li>Clear browser or app data to remove local projects</li>
					<li>Uninstall the desktop app if installed</li>
				</ul>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Contact us</h2>
				<p>Questions about these terms or need to report an issue?</p>
				<p>
					Contact us through our{" "}
					<a
						href={`${SOCIAL_LINKS.github}/issues`}
						target="_blank"
						rel="noopener"
						className="text-primary hover:underline"
					>
						GitHub repository
					</a>
					, email us at{" "}
					<a
						href="mailto:oss@mangocut.app"
						className="text-primary hover:underline"
					>
						oss@mangocut.app
					</a>
					, or reach out on{" "}
					<a
						href={SOCIAL_LINKS.x}
						target="_blank"
						rel="noopener"
						className="text-primary hover:underline"
					>
						X (Twitter)
					</a>
					.
				</p>
				<p>
					These terms are governed by applicable law in your jurisdiction. We
					prefer to resolve disputes through discussion when possible.
				</p>
			</section>
			<Separator />
			<p className="text-muted-foreground text-sm">
				Last updated: September 30, 2026
			</p>
		</BasePage>
	);
}
