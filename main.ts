import { App, Editor, MarkdownView, Modal, Notice, Platform, Plugin, PluginSettingTab, requestUrl, Setting, SuggestModal } from 'obsidian';
import { convertIcsCalendar, extendByRecurrenceRule, IcsCalendar, IcsEvent, IcsEvent } from 'ts-ics';

interface CalToEventPluginSettings {
	sourceUrl: string | null;
	refreshIntervalMinutes: number;
	cache: {
		events: IcsEvent[];
	}
}

const DEFAULT_SETTINGS: CalToEventPluginSettings = {
	sourceUrl: null,
	refreshIntervalMinutes: 15,
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
				new CalendarEventsModal(this.app, this.settings.cache.events,).open();
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

export class CalendarEventsModal extends SuggestModal<IcsEvent> {
	constructor(app: App, private events: IcsEvent[]) {
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

		// TODO: Based on event date and time, as well as summary
		const fileName = `${sanitizedSummary}.md`;

		this.app.vault.create(fileName, `Desc:\n${event.description}\n\nLocation:\n${event.location}`)
			.then((file) => {
				this.app.workspace.getLeaf().openFile(file);
			});
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
	}
}
