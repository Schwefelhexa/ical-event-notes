import * as exp from 'constants';
import { App, Editor, MarkdownView, Modal, Notice, Platform, Plugin, PluginSettingTab, requestUrl, Setting, SuggestModal, TFile } from 'obsidian';
import { release } from 'os';
import { convertIcsCalendar, extendByRecurrenceRule, IcsCalendar, IcsEvent } from 'ts-ics';

// TODO: Auto-link people notes - i.e. look up if name exists, or note with alias of name/email

interface CalToEventPluginSettings {
	calendarSources: CalendarSource[];
	refreshIntervalMinutes: number;
	eventNoteTemplate: string;
	cache: {
		events: CachedEvent[];
	}
}

type CalendarSource = {
	name: string;
	url: string;
}

type CachedEvent = {
	calendarSource: CalendarSource;
} & IcsEvent;

const EVENT_NOTE_TEMPLATE = `---
tags: event
title: "{{date}} - {{summary}}"
date: {{date}}
summary: "{{summary}}"
location: "{{location}}"
---

_Your notes here_

---

**When:** {{start}} - {{end}}
**Where:** {{location}}
**Participants:** {{attendees}}
**Event Details:**
{{description}}
`;

const searchLookahead = 24 * 60 * 60 * 1000; // 24 hours
const searchLookbehind = 60 * 60 * 1000; // 1 hour

const DEFAULT_SETTINGS: CalToEventPluginSettings = {
	calendarSources: [],
	refreshIntervalMinutes: 15,
	eventNoteTemplate: EVENT_NOTE_TEMPLATE,
	cache: {
		events: []
	}
}

function normalizeDate(date: Date | string | undefined): Date | undefined {
	if (date instanceof Date) return date;
	if (typeof date === 'string') {
		const parsed = new Date(date);
		if (!isNaN(parsed.getTime())) return parsed;
	}
	return undefined;
}

function expandRelevantEvents(events: CachedEvent[], now: Date): CachedEvent[] {
	return events.flatMap(event => {
		if (!event.recurrenceRule) return [event];

		const start = new Date(now.getTime() - searchLookbehind);
		const end = new Date(now.getTime() + searchLookahead);

		// Map each occurrence to an event instance
		const recurrences = extendByRecurrenceRule(event.recurrenceRule, { start, end })

		const occurrences: CachedEvent[] = recurrences.map(date => {
			const eventDuration = (event.end!.date.getTime() - event.start.date.getTime())
			const end = new Date(date.getTime() + eventDuration)

			return {
				...event,
				id: `${event.recurrenceId ?? event.uid}-${date.toISOString()}`, // Unique ID per occurrence
				start: { ...event.start, date: date },
				end: { ...event.end, date: new Date(date.getTime() + (event.end!.date.getTime() - event.start!.date.getTime())) }, // Maintain duration
				recurrenceRule: undefined // Clear recurrence rule for occurrences
			};
		});

		return occurrences;
	})
}

function eventRelevance(event: CachedEvent, now: Date): number {
	const nowMilis = now.getTime()
	const cutoffLookbehind = new Date(nowMilis - searchLookbehind).getTime()
	const cutoffLookahead = new Date(nowMilis + searchLookahead).getTime()

	const start = normalizeDate(event.start?.date)?.getTime();
	const end = normalizeDate(event.end?.date)?.getTime();
	if (!start || !end) return -1;

	// Current events
	if (start < nowMilis && end > nowMilis) return Number.MAX_VALUE
	// Recently ended
	if (end < nowMilis && end >= cutoffLookbehind) return Math.floor((nowMilis - end) / 1000 / 60)
	// Upcoming
	if (start > nowMilis && start <= cutoffLookahead) return Math.floor((start - nowMilis) / 1000 / 60)

	// Outside of relevance window
	return -1
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
				const now = new Date()
				const relevantEvents = this.settings.cache.events.map(evnt => [evnt, eventRelevance(evnt, now)] as const)
					.filter(([_, relevance]) => relevance > 0)
					.sort(([_, relevanceA], [__, relevanceB]) => relevanceA - relevanceB)
					.map(([evnt, _]) => evnt)

				new CalendarEventsModal(this.app, relevantEvents, this).open();
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

		if ((this.settings.calendarSources?.length ?? 0) === 0) {
			new SampleModal(this.app, 'No source URL configured.').open();
			return;
		}

		const result: CachedEvent[] = []

		for (const source of this.settings.calendarSources) {
			const res = await requestUrl({ url: source.url, method: "GET", headers: {} });
			if (res.status !== 200 || !res.text) {
				// TODO: Error handling
				return;
			}

			const calendar: IcsCalendar = convertIcsCalendar(undefined, res.text);
			const events = calendar.events ?? [];

			// Normalize dates
			const normalizedEvents = events.map(event => ({
				...event,
				start: { ...event.start, date: normalizeDate(event.start?.date) },
				end: { ...event.end, date: normalizeDate(event.end?.date) },
				calendarSource: source
			}) as CachedEvent);

			result.push(...normalizedEvents);
		}

		this.settings.cache.events = result;
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

export class CalendarEventsModal extends SuggestModal<CachedEvent> {
	constructor(app: App, private events: CachedEvent[], private plugin: IcalToEventsPlugin) {
		super(app);
	}

	// Returns all available suggestions.
	getSuggestions(query: string): CachedEvent[] {
		return this.events.filter((event) =>
			// TODO: Fuzzy search; don't search only on summary
			event.summary?.toLowerCase().includes(query.toLowerCase())
		);
	}

	// Renders each suggestion item.
	renderSuggestion(event: CachedEvent, el: HTMLElement) {
		el.createEl('div', { text: event.summary });
		el.createEl('small', { text: event.calendarSource.name + " | " + (event.start?.date?.toLocaleString() ?? '') }); // TODO: Format better
	}

	// Perform action on the selected suggestion.
	onChooseSuggestion(event: CachedEvent, evt: MouseEvent | KeyboardEvent) {
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
			.setName('Calendar Sources')
			.setDesc('List of calendar sources to fetch events from')
			.addTextArea(text => text
				.setPlaceholder('Work Calendar,https://example.com/work.ics\nPersonal Calendar,https://example.com/personal.ics')
				.setValue(this.plugin.settings.calendarSources.map(src => `${src.name},${src.url}`).join('\n'))
				.onChange(async (value) => {
					const lines = value.split('\n').map(line => line.trim()).filter(line => line.length > 0);
					const sources: CalendarSource[] = [];
					for (const line of lines) {
						const [name, url] = line.split(',').map(part => part.trim());
						if (name && url) {
							sources.push({ name, url });
						}
					}
					this.plugin.settings.calendarSources = sources;
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
