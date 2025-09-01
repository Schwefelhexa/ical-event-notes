import { App, Editor, MarkdownView, Modal, Notice, Platform, Plugin, PluginSettingTab, requestUrl, Setting } from 'obsidian';
import { convertIcsCalendar, extendByRecurrenceRule, IcsCalendar } from 'ts-ics';

interface CalToEventPluginSettings {
	sourceUrl: string | null;
	refreshIntervalMinutes: number;
	cache: {
		events: IcsCalendar['events'];
	}
}

const DEFAULT_SETTINGS: CalToEventPluginSettings = {
	sourceUrl: null,
	refreshIntervalMinutes: 15
}

export default class IcalToEventsPlugin extends Plugin {
	settings: CalToEventPluginSettings;

	async onload() {
		await this.loadSettings();

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'reload-calendar',
			name: 'Reload Calendar',
			callback: () => {
				this.refresh();
			}
		});

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
		const expandedEvents = events.flatMap(event => {
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

		new SampleModal(this.app, `Fetched ${calendar.events?.length ?? 0} events.`).open();
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
