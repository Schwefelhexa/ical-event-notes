import * as exp from 'constants';
import { App, Editor, MarkdownView, Modal, Notice, Platform, Plugin, PluginSettingTab, requestUrl, Setting, SuggestModal, TFile } from 'obsidian';
import { convertIcsCalendar, extendByRecurrenceRule, IcsCalendar, IcsEvent, IcsEvent } from 'ts-ics';

interface CalToEventPluginSettings {
	sourceUrl: string | null;
	refreshIntervalMinutes: number;
	eventNoteTemplate: string;
	cache: {
		events: IcsEvent[];
	}
}

const EVENT_NOTE_TEMPLATE = `---
tags: event
title: "{{date}} - {{summary}}"
date: {{date}}
summary: {{summary}}
location: {{location}}
---
**When:** {{start}} - {{end}}
**Where:** {{location}}
**Participants:** {{attendees}}

---

_Your notes here_

---

**Event Details:**
{{description}}
`;

const DEFAULT_SETTINGS: CalToEventPluginSettings = {
	sourceUrl: null,
	refreshIntervalMinutes: 15,
	eventNoteTemplate: EVENT_NOTE_TEMPLATE,
	cache: {
		events: []
	}
}

export default class IcalToEventsPlugin extends Plugin {
	settings: CalToEventPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'reload-calendar',
			name: 'Reload Calendar',
			callback: () => {
				this.refresh();
			}
		});

		this.addCommand({
			id: 'create-note-from-event',
			name: 'Create/Open Note from Event',
			callback: () => {
				// TODO: Only show in-progress, recently ended, and upcoming events
				new CalendarEventsModal(this.app, this.settings.cache.events, this).open();
			}
		})

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new IcalToEventsSettingTab(this.app, this));

		// Register interval-based and focus-based refresh
		if (!Platform.isMobileApp) {
			this.registerInterval(window.setInterval(() => this.refresh(), this.settings.refreshIntervalMinutes * 60 * 1000));
		}
		this.registerDomEvent(window, 'focus', (evt: MouseEvent) => {
			this.refresh();
		});
	}

	async refresh() {
		// TODO: Fetch/refresh calendar data
		// Needs debouncing, since mobile triggers focus pretty often

		if (!this.settings.sourceUrl) {
			new SampleModal(this.app, 'No source URL configured.').open();
			return;
		}

		const res = await requestUrl({ url: this.settings.sourceUrl, method: "GET", headers: {} });
		if (res.status !== 200 || !res.text) {
			// TODO: Error handling
			return;
		}

		const calendar: IcsCalendar = convertIcsCalendar(undefined, res.text);

		const events = calendar.events ?? [];
		const expandedEvents: IcsEvent[] = events.flatMap(event => {
			if (!event.recurrenceRule) return [event];

			// TODO: Tweak this
			const start = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30); // 30 days ago
			const end = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365); // 1 year in future

			// Map each occurrence to an event instance
			const recurrences = extendByRecurrenceRule(event.recurrenceRule, { start, end })
			const occurrences = recurrences.map(date => {
				return {
					...event,
					id: `${event.recurrenceId ?? event.uid}-${date.toISOString()}`, // Unique ID per occurrence
					start: date,
					end: new Date(date.getTime() + (event.end!.date.getTime() - event.start!.date.getTime())), // Maintain duration
					recurrenceRule: undefined // Clear recurrence rule for occurrences
				};
			});

			console.log(`Expanded event ${event.summary} into ${occurrences.length} occurrences.`);
			return occurrences;
		})

		function normalizeDate(date: Date | string | undefined): Date | undefined {
			if (date instanceof Date) return date;
			if (typeof date === 'string') {
				const parsed = new Date(date);
				if (!isNaN(parsed.getTime())) return parsed;
			}
			return undefined;
		}

		// Normalize dates
		const normalizedEvents = expandedEvents.map(event => ({
			...event,
			start: { ...event.start, date: normalizeDate(event.start?.date) },
			end: { ...event.end, date: normalizeDate(event.end?.date) },
		}) as IcsEvent);

		this.settings.cache.events = expandedEvents;
		await this.saveSettings();
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App, private text?: string) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText(this.text ?? 'Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

function formatEvent(template: string, event: IcsEvent): string {
	const replacements: { [key: string]: string } = {
		'{{summary}}': event.summary ?? '',
		'{{location}}': event.location ?? '',
		'{{description}}': event.description ?? '',
		'{{attendees}}': (event.attendees ?? []).map(a => a.name ?? a.email ?? '').join(', '),
	};

	if (event.start?.date instanceof Date) {
		replacements['{{date}}'] = event.start.date.toLocaleDateString();
		replacements['{{start}}'] = event.start.date.toLocaleString();
	} else {
		replacements['{{date}}'] = JSON.stringify(event.start?.date) ?? '_undefined_';
		replacements['{{start}}'] = JSON.stringify(event.start?.date) ?? '_undefined_';
	}
	if (event.end?.date instanceof Date) {
		replacements['{{end}}'] = event.end.date.toLocaleString();
	} else {
		replacements['{{end}}'] = JSON.stringify(event.end?.date) ?? '_undefined_';
	}

	let result = template;
	for (const [key, value] of Object.entries(replacements)) {
		result = result.replace(new RegExp(key, 'g'), value);
	}
	return result;
}

export class CalendarEventsModal extends SuggestModal<IcsEvent> {
	constructor(app: App, private events: IcsEvent[], private plugin: IcalToEventsPlugin) {
		super(app);
	}

	// Returns all available suggestions.
	getSuggestions(query: string): IcsEvent[] {
		return this.events.filter((event) =>
			// TODO: Fuzzy search; don't search only on summary
			event.summary?.toLowerCase().includes(query.toLowerCase())
		);
	}

	// Renders each suggestion item.
	renderSuggestion(event: IcsEvent, el: HTMLElement) {
		el.createEl('div', { text: event.summary });
		el.createEl('small', { text: event.start?.date?.toLocaleString() ?? '' }); // TODO: Format better
	}

	// Perform action on the selected suggestion.
	onChooseSuggestion(event: IcsEvent, evt: MouseEvent | KeyboardEvent) {
		const sanitizedSummary = event.summary?.replace(/[\/\\?%*:|"<>]/g, '-') ?? 'Event';

		const datePart = event.start?.date instanceof Date
			? event.start.date.toISOString().split('T')[0] + " | "
			: '';

		const fileName = `${datePart}${sanitizedSummary}.md`;

		// Open file if it already exists
		const existingFile = this.app.vault.getAbstractFileByPath(fileName);
		if (existingFile && existingFile instanceof TFile) {
			this.app.workspace.getLeaf().openFile(existingFile);
			return;
		}

		this.app.vault.create(fileName, formatEvent(this.plugin.settings.eventNoteTemplate, event))
			.then((file) => {
				this.app.workspace.getLeaf().openFile(file);
			})
	}
}

class IcalToEventsSettingTab extends PluginSettingTab {
	plugin: IcalToEventsPlugin;

	constructor(app: App, plugin: IcalToEventsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Source URL')
			.setDesc('iCal URL to fetch')
			.addText(text => text
				.setPlaceholder('https://example.com/calendar.ics')
				.setValue(this.plugin.settings.sourceUrl ?? '')
				.onChange(async (value) => {
					this.plugin.settings.sourceUrl = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Refresh Interval (minutes)')
			.setDesc('How often to refresh the calendar data')
			.addText(text => text
				.setPlaceholder('15')
				.setValue(this.plugin.settings.refreshIntervalMinutes.toString())
				.onChange(async (value) => {
					const intValue = parseInt(value);
					if (!isNaN(intValue) && intValue > 0) {
						this.plugin.settings.refreshIntervalMinutes = intValue;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Event Note Template')
			.setDesc('Template for event notes. Use {{placeholders}} for event properties.')
			.addTextArea(text => text
				.setPlaceholder(EVENT_NOTE_TEMPLATE)
				.setValue(this.plugin.settings.eventNoteTemplate)
				.onChange(async (value) => {
					this.plugin.settings.eventNoteTemplate = value;
					await this.plugin.saveSettings();
				}));
	}
}
