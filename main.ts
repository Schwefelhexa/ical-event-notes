import { App, Editor, MarkdownView, Modal, Notice, Platform, Plugin, PluginSettingTab, requestUrl, Setting } from 'obsidian';

interface CalToEventPluginSettings {
	sourceUrl: string | null;
	refreshIntervalMinutes: number;
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

		if (!this.settings.sourceUrl) return;

		const res = await requestUrl({ url: this.settings.sourceUrl, method: "GET", headers: {} });
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