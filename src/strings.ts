/**
 * DE/EN copy for c15t's i18n (`i18n.messages` keyed by language). Keys match
 * c15t's `Translations` shape (verified against @c15t/translations 3.0.0):
 *   common.*, cookieBanner.*, consentManagerDialog.*, consentTypes.<cat>.*
 * German is the default; English is used when the page locale starts with "en".
 *
 * Accept and Reject are deliberately given equal, neutral wording (no dark
 * pattern). This file is the single place operator-facing wording lives.
 * Wording is a starting point, not legal advice - have it reviewed.
 */
export const strings = {
	de: {
		common: {
			acceptAll: "Alle akzeptieren",
			rejectAll: "Alle ablehnen",
			customize: "Einstellungen",
			save: "Auswahl speichern",
			close: "Schließen",
			securedBy: "Bereitgestellt von",
		},
		cookieBanner: {
			title: "Datenschutz-Einstellungen",
			description:
				"Wir verwenden Cookies und ähnliche Technologien. Notwendige sind immer aktiv. Für Analyse und Marketing bitten wir um Ihre Einwilligung. Sie können sie jederzeit ändern oder widerrufen.",
		},
		consentManagerDialog: {
			title: "Datenschutz-Einstellungen",
			description:
				"Hier legen Sie fest, welche Cookies und Technologien Sie zulassen. Ihre Auswahl können Sie jederzeit ändern.",
		},
		consentTypes: {
			necessary: {
				title: "Notwendig",
				description: "Diese Cookies sind für den Betrieb der Website erforderlich und können nicht deaktiviert werden.",
			},
			measurement: {
				title: "Analyse",
				description: "Helfen uns zu verstehen, wie Besucher die Website nutzen, damit wir sie verbessern können.",
			},
			marketing: {
				title: "Marketing",
				description: "Werden verwendet, um relevante Werbung auszuspielen und deren Wirkung zu messen.",
			},
		},
	},
	en: {
		common: {
			acceptAll: "Accept all",
			rejectAll: "Reject all",
			customize: "Settings",
			save: "Save choices",
			close: "Close",
		},
		cookieBanner: {
			title: "Privacy settings",
			description:
				"We use cookies and similar technologies. Necessary ones are always on. For analytics and marketing we ask for your consent. You can change or withdraw it at any time.",
		},
		consentManagerDialog: {
			title: "Privacy settings",
			description: "Choose which cookies and technologies you allow. You can change your choice at any time.",
		},
		consentTypes: {
			necessary: {
				title: "Necessary",
				description: "These cookies are required for the website to work and cannot be turned off.",
			},
			measurement: {
				title: "Analytics",
				description: "Help us understand how visitors use the website so we can improve it.",
			},
			marketing: {
				title: "Marketing",
				description: "Used to deliver relevant advertising and measure its effectiveness.",
			},
		},
	},
} as const;
