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
	title: "Privacy Policy - Mangocut",
	description:
		"Learn how Mangocut handles your data and privacy. Our commitment to protecting your information while you edit videos with AI.",
	openGraph: {
		title: "Privacy Policy - Mangocut",
		description:
			"Learn how Mangocut handles your data and privacy. Our commitment to protecting your information while you edit videos with AI.",
		type: "website",
	},
};

export default function PrivacyPage() {
	return (
		<BasePage
			title="Privacy policy"
			description="Learn how we handle your data and privacy. Contact us if you have any questions."
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
							Editing stays local. Optional AI and sign-in are opt-in.
						</h3>
						<ol className="list-decimal space-y-2 pl-6">
							<li>
								Your video projects and media files stay on your device by
								default (browser storage or the desktop app)
							</li>
							<li>
								You can sign in with Google to manage AI trial usage tied to
								your account
							</li>
							<li>
								When you use cloud AI features, prompts and related context you
								send (and optional preview frames for vision) are processed by
								our AI providers to fulfill your request
							</li>
							<li>
								On-device tools such as local speech transcription keep audio on
								your device
							</li>
							<li>
								We do not sell your personal data or your media
							</li>
							<li>
								You can sign out, clear local data, or stop using AI features at
								any time
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
				<h2 className="text-2xl font-semibold">Who we are</h2>
				<p>
					Mangocut (“we”, “us”) is an AI-assisted video editor available on the
					web and as a desktop app. This policy explains what we collect, why,
					and how we handle it when you use{" "}
					<a
						href="https://mangocut.jonam.dev"
						className="text-primary hover:underline"
					>
						mangocut.jonam.dev
					</a>{" "}
					or related Mangocut applications.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">How we handle your content</h2>
				<p>
					<strong>
						Core editing happens on your device.
					</strong>{" "}
					Projects, timelines, and media are stored locally (for example in
					browser IndexedDB, or under desktop app storage). We do not use your
					raw project library as a cloud media store.
				</p>
				<p>
					Optional cloud AI features (such as AI chat and vision-assisted
					editing help) only run when you use them. In those cases, the text you
					send and any media snippets or frames needed for the request are
					transmitted to Mangocut’s servers so we can route the request to our AI
					model providers and return a response. We process that data to provide
					the feature you asked for, enforce usage limits, and keep the service
					reliable and secure.
				</p>
				<p>
					Some AI-related tools (including local speech transcription) run on
					your device and do not upload your audio for that purpose.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Accounts &amp; Google sign-in</h2>
				<p>
					Mangocut offers optional Google sign-in (via OAuth) so we can
					authenticate you and associate AI trial usage with your account.
				</p>
				<p>When you sign in with Google, we may receive:</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>Your Google account email address</li>
					<li>Your name</li>
					<li>Your profile image URL (if available)</li>
					<li>A stable account identifier from the sign-in provider</li>
				</ul>
				<p>
					We use this information to create and maintain your Mangocut session,
					show account context in the product, gate AI entitlements / free-trial
					limits, and prevent abuse. Session cookies or similar credentials may
					be stored in your browser so you stay signed in.
				</p>
				<p>
					We do not use Google sign-in to access your Google Drive, Gmail, or
					other Google services beyond the basic profile scopes needed to sign
					you in.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">AI usage &amp; device identifiers</h2>
				<p>
					To enforce free-trial or rate limits, we may store AI usage counters
					keyed to your signed-in account ID, or—when you are not signed
					in—to a local device identifier or similar technical signal. These
					counters are operational data for entitlement enforcement, not
					advertising profiles.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Analytics</h2>
				<p>
					We may use{" "}
					<a
						href="https://www.databuddy.cc"
						target="_blank"
						rel="noopener noreferrer"
						className="text-primary hover:underline"
					>
						Databuddy
					</a>{" "}
					or similar privacy-oriented analytics for basic, aggregated product
					and site metrics. We do not sell analytics data, and we do not use
					analytics to rebuild the contents of your video projects.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Local storage &amp; cookies</h2>
				<p>We use browser local storage, IndexedDB, and cookies/session storage to:</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>Save projects and editor preferences on your device</li>
					<li>Keep you signed in when you choose Google authentication</li>
					<li>Remember UI state needed for the editor between sessions</li>
					<li>Support AI trial / device entitlement checks when unsigned-in</li>
				</ul>
				<p>
					You can clear local data through your browser or OS settings. Clearing
					storage may delete local projects and sign you out.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Third-party services</h2>
				<p>
					Depending on how you use Mangocut, we may share limited data with:
				</p>
				<ul className="list-disc space-y-2 pl-6">
					<li>
						<strong>Google:</strong> Authentication (sign-in) when you choose
						Google OAuth
					</li>
					<li>
						<strong>AI model providers (for example OpenRouter and upstream
						models):</strong> Prompts and related request context you submit
						when using cloud AI features
					</li>
					<li>
						<strong>Hosting / infrastructure providers:</strong> To run the web
						app, APIs, and delivery (for example Vercel or equivalent)
					</li>
					<li>
						<strong>Analytics providers:</strong> Aggregated site/product metrics
						as described above
					</li>
				</ul>
				<p>
					These providers process data under their own terms and privacy
					policies, limited to what is needed to provide their service to us.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Data retention</h2>
				<p>
					Account and session data are kept while your account/session is active
					and as needed for security, abuse prevention, and legal obligations.
					Local projects remain on your device until you delete them or clear
					storage. AI request payloads are processed to fulfill requests and are
					not used by Mangocut as a long-term media library.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Your rights &amp; choices</h2>
				<ul className="list-disc space-y-2 pl-6">
					<li>You can use core editing features without signing in</li>
					<li>You can sign out of Google authentication at any time</li>
					<li>You can avoid cloud AI features if you do not want prompts or frames sent to providers</li>
					<li>You can clear local storage to remove local projects and preferences</li>
					<li>
						Depending on where you live, you may have rights to access, correct,
						or delete personal data we hold—contact us to make a request
					</li>
				</ul>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Children</h2>
				<p>
					Mangocut is not directed at children under 13 (or the equivalent
					minimum age in your region). Do not sign in or use account features if
					you are under that age.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Open source transparency</h2>
				<p>
					Much of Mangocut is open source. You can review how the product is
					built, including how authentication and AI request routing are
					implemented.
				</p>
				<p>
					View our source code on{" "}
					<a
						href={SOCIAL_LINKS.github}
						target="_blank"
						rel="noopener"
						className="text-primary hover:underline"
					>
						GitHub
					</a>
					.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Changes</h2>
				<p>
					We may update this policy as the product evolves. The “Last updated”
					date below will change when we do. Continued use after an update means
					you accept the revised policy.
				</p>
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-2xl font-semibold">Contact us</h2>
				<p>Questions about this privacy policy or how we handle your data?</p>
				<p>
					Open an issue on our{" "}
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
			</section>

			<Separator />

			<p className="text-muted-foreground text-sm">
				Last updated: September 30, 2026
			</p>
		</BasePage>
	);
}
