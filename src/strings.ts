/**
 * DE/EN copy passed to c15t's i18n. German is the default; English is used
 * when the page locale starts with "en". These override c15t's bundled
 * translations for the strings a German consent banner must get exactly
 * right (equal-weight accept/reject, "Einstellungen", category names).
 *
 * NOTE: exact message keys depend on the c15t translation schema and are
 * confirmed when wiring `banner.ts` against the real bundle. Keep this file as
 * the single place the operator-facing wording lives.
 */
export const strings = {
	de: {
		banner: {
			title: "Datenschutz-Einstellungen",
			description:
				"Wir verwenden Cookies und ähnliche Technologien. Notwendige sind immer aktiv. Für Analyse und Marketing bitten wir um Ihre Einwilligung.",
			acceptAll: "Alle akzeptieren",
			rejectAll: "Ablehnen",
			customize: "Einstellungen",
			save: "Auswahl speichern",
		},
		categories: {
			necessary: "Notwendig",
			measurement: "Analyse",
			marketing: "Marketing",
		},
		reopen: "Cookie-Einstellungen",
	},
	en: {
		banner: {
			title: "Privacy settings",
			description:
				"We use cookies and similar technologies. Necessary ones are always on. For analytics and marketing we ask for your consent.",
			acceptAll: "Accept all",
			rejectAll: "Reject",
			customize: "Settings",
			save: "Save choices",
		},
		categories: {
			necessary: "Necessary",
			measurement: "Analytics",
			marketing: "Marketing",
		},
		reopen: "Cookie settings",
	},
} as const;
