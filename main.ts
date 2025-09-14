import * as exp from 'constants';
import { App, Editor, MarkdownView, Modal, Notice, Platform, Plugin, PluginSettingTab, requestUrl, Setting, SuggestModal, TFile } from 'obsidian';
import { release } from 'os';
import { convertIcsCalendar, extendByRecurrenceRule, IcsAttendee, IcsCalendar, IcsEvent } from 'ts-ics';

interface CalToEventPluginSettings {
	calendarSources: CalendarSource[];
	refreshIntervalMinutes: number;
	eventNoteTemplate: string;
	targetDirectory: string;
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
	targetDirectory: "/",
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
				uid: `${event.recurrenceId ?? event.uid}-${date.toISOString()}`, // Unique ID per occurrence
				start: { ...event.start, date: date },
				end: { ...event.end, date: new Date(date.getTime() + (event.end!.date.getTime() - event.start!.date.getTime())) }, // Maintain duration
				recurrenceRule: undefined, // Clear recurrence rule for occurrences
				duration: undefined // Clear duration for occurrences
			} as CachedEvent;
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

function findByNameOrAlias(app: App, target: string): TFile | null {
	const { metadataCache, vault } = app;

	const sanitizedTarget = target.replace(/\.md$/, '').trim();

	for (const file of vault.getMarkdownFiles()) {
		// Direct filename match (without extension)
		const basename = file.basename;
		if (basename.toLowerCase() === sanitizedTarget.toLowerCase()) {
			return file;
		}

		// Look up aliases in frontmatter
		const cache = metadataCache.getFileCache(file);
		const aliases = cache?.frontmatter?.aliases || cache?.frontmatter?.alias;

		if (aliases) {
			const aliasList = Array.isArray(aliases) ? aliases : [aliases];
			if (aliasList.some(a => a.toLowerCase() === sanitizedTarget.toLowerCase())) {
				return file;
			}
		}
	}
	return null;
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
		this.addSettingTab(new IcalToEventsSettingTab(this.app, this, this.refresh.bind(this)));

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

/**
* Tries to create a markdown link to a note matching the attendee's name or email.
* If no matching note is found, returns the attendee's name or email as plain text.
*/
function tryMakeAttendeeLink(app: App, attendee: IcsAttendee): string {
	const attempts = [attendee.name, `@${attendee.name ?? ""}`, attendee.email].map(a => a?.trim()).filter(s => s && s.length > 0 && s !== '@');

	for (const attempt of attempts) {
		if (!attempt) continue;
		const file = findByNameOrAlias(app, attempt);
		if (!file) continue;

		return `[[${file.path}|${attempt}]]`;
	}

	return attendee.name ?? attendee.email ?? '';
}

function formatEvent(template: string, event: IcsEvent, app: App): string {
	const replacements: { [key: string]: string } = {
		'{{summary}}': event.summary ?? '',
		'{{location}}': event.location ?? '',
		'{{description}}': event.description ?? '',
		'{{attendees}}': (event.attendees ?? []).map(a => a.name ?? a.email ?? '').join(', '),
		'{{attendees_links}}': (event.attendees ?? []).map(a => tryMakeAttendeeLink(app, a)).join(', '),
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
		let sanitizedSummary = event.summary?.replace(/[\/\\?%*:|"<>]/g, '-') ?? 'Event';
		for (const char of ['[', ']', '^', '$']) {
			sanitizedSummary = sanitizedSummary.replace(char, '');
		}

		const datePart = event.start?.date instanceof Date
			? event.start.date.toISOString().split('T')[0] + " — "
			: event.start?.date ?? '';

		const fileName = `${datePart}${sanitizedSummary}.md`;

		// Open existing file if it exists
		const existingFile = findByNameOrAlias(this.app, fileName);
		if (existingFile) {
			this.app.workspace.getLeaf().openFile(existingFile);
			return;
		}

		// Create target directory if it doesn't exist
		const targetDir = this.plugin.settings.targetDirectory;
		if (targetDir && targetDir !== '/') {
			const dirExists = this.app.vault.getAbstractFileByPath(targetDir.slice(1, -1));
			if (!dirExists) {
				this.app.vault.createFolder(targetDir.slice(1, -1)).catch(err => {
					new Notice(`Failed to create directory ${targetDir}: ${err.message}`);
				});
			}
		}

		const fullPath = targetDir + fileName;
		this.app.vault.create(fullPath, formatEvent(this.plugin.settings.eventNoteTemplate, event, this.app))
			.then((file) => {
				this.app.workspace.getLeaf().openFile(file);
			})
	}
}

class IcalToEventsSettingTab extends PluginSettingTab {
	plugin: IcalToEventsPlugin;

	constructor(app: App, plugin: IcalToEventsPlugin, private refreshCache: () => Promise<void>) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Main heading
		containerEl.createEl('h1', { text: 'iCal Event Notes Settings' });

		// Calendar Sources Section
		containerEl.createEl('h2', { text: 'Calendar Sources' });
		containerEl.createEl('p', {
			text: 'Add your calendar URLs (iCal/ICS format) to sync events from.',
			cls: 'setting-item-description'
		});

		const sourcesContainer = containerEl.createDiv('calendar-sources-container');
		sourcesContainer.style.marginBottom = '30px';

		this.plugin.settings.calendarSources.forEach((source, index) => {
			const sourceRow = sourcesContainer.createDiv('calendar-source-row');
			sourceRow.style.display = 'flex';
			sourceRow.style.alignItems = 'center';
			sourceRow.style.marginBottom = '8px';
			sourceRow.style.gap = '8px';

			// Name input (smaller)
			const nameInput = sourceRow.createEl('input', {
				type: 'text',
				placeholder: 'Calendar name',
				value: source.name
			});
			nameInput.style.flex = '0 0 180px';
			nameInput.style.padding = '6px 10px';
			nameInput.style.border = '1px solid var(--background-modifier-border)';
			nameInput.style.borderRadius = '4px';
			nameInput.style.backgroundColor = 'var(--background-primary)';
			nameInput.style.color = 'var(--text-normal)';
			nameInput.style.fontSize = '14px';
			nameInput.addEventListener('input', async (e) => {
				this.plugin.settings.calendarSources[index].name = (e.target as HTMLInputElement).value;
				await this.plugin.saveSettings();
			});
			nameInput.addEventListener('blur', async () => {
				await this.refreshCache();
			});

			// URL input (wider)
			const urlInput = sourceRow.createEl('input', {
				type: 'url',
				placeholder: 'https://calendar.google.com/calendar/ical/...',
				value: source.url
			});
			urlInput.style.flex = '1';
			urlInput.style.padding = '6px 10px';
			urlInput.style.border = '1px solid var(--background-modifier-border)';
			urlInput.style.borderRadius = '4px';
			urlInput.style.backgroundColor = 'var(--background-primary)';
			urlInput.style.color = 'var(--text-normal)';
			urlInput.style.fontSize = '14px';
			urlInput.addEventListener('input', async (e) => {
				this.plugin.settings.calendarSources[index].url = (e.target as HTMLInputElement).value;
				await this.plugin.saveSettings();
			});
			urlInput.addEventListener('blur', async () => {
				await this.refreshCache();
			});

			// Remove button (X)
			const removeBtn = sourceRow.createEl('button', {
				text: '×',
				attr: { 'aria-label': 'Remove calendar source' }
			});
			removeBtn.style.width = '28px';
			removeBtn.style.height = '28px';
			removeBtn.style.padding = '0';
			removeBtn.style.border = 'none';
			removeBtn.style.borderRadius = '4px';
			removeBtn.style.backgroundColor = 'transparent';
			removeBtn.style.color = 'var(--text-muted)';
			removeBtn.style.fontSize = '20px';
			removeBtn.style.lineHeight = '1';
			removeBtn.style.cursor = 'pointer';
			removeBtn.style.display = 'flex';
			removeBtn.style.alignItems = 'center';
			removeBtn.style.justifyContent = 'center';
			removeBtn.style.transition = 'all 0.1s ease-in-out';
			removeBtn.addEventListener('mouseenter', () => {
				removeBtn.style.backgroundColor = 'var(--background-modifier-error)';
				removeBtn.style.color = 'var(--text-on-accent)';
			});
			removeBtn.addEventListener('mouseleave', () => {
				removeBtn.style.backgroundColor = 'transparent';
				removeBtn.style.color = 'var(--text-muted)';
			});
			removeBtn.addEventListener('click', async () => {
				this.plugin.settings.calendarSources.splice(index, 1);
				await this.plugin.saveSettings();
				this.display();
			});
		});

		new Setting(containerEl)
			.setName('')
			.addButton(button => button
				.setButtonText('+ Add Calendar')
				.setCta()
				.onClick(async () => {
					this.plugin.settings.calendarSources.push({ name: '', url: '' });
					await this.plugin.saveSettings();
					this.display();
				}));

		// Note Creation Section
		containerEl.createEl('h2', { text: 'Note Creation' });

		// Target Directory with autocomplete
		const directorySetting = new Setting(containerEl)
			.setName('Notes Location')
			.setDesc('Where to create event notes in your vault');

		// Get all folders in vault for suggestions
		const folders: string[] = ['/'];
		const folderSet = new Set<string>();

		// Get all files and folders
		const allFiles = this.app.vault.getAllLoadedFiles();

		allFiles.forEach(abstractFile => {
			// Check if it's a folder (TFolder type check)
			if ('children' in abstractFile) {
				// It's a folder
				const folderPath = '/' + abstractFile.path + '/';
				if (abstractFile.path && !folderSet.has(folderPath)) {
					folderSet.add(folderPath);
					folders.push(folderPath);
				}
			} else {
				// It's a file - extract parent folders
				const path = abstractFile.path;
				const lastSlash = path.lastIndexOf('/');
				if (lastSlash > 0) {
					const parentPath = '/' + path.substring(0, lastSlash) + '/';
					if (!folderSet.has(parentPath)) {
						folderSet.add(parentPath);
						folders.push(parentPath);
					}
				}
			}
		});

		// Sort folders alphabetically
		folders.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

		directorySetting.addSearch(search => {
			search
				.setPlaceholder('e.g., /Events or /Calendar/2024')
				.setValue(this.plugin.settings.targetDirectory)
				.onChange(async (value) => {
					let normalized = value.trim();
					if (normalized && !normalized.startsWith('/')) normalized = '/' + normalized;
					if (normalized && !normalized.endsWith('/')) normalized += '/';

					this.plugin.settings.targetDirectory = normalized || '/';
					await this.plugin.saveSettings();
				});

			// Add autocomplete suggestions
			const searchInput = search.inputEl;
			searchInput.addEventListener('focus', () => {
				const currentValue = searchInput.value.toLowerCase();
				const suggestions = folders.filter(f =>
					f.toLowerCase().includes(currentValue)
				).slice(0, 5);

				// Simple autocomplete (you could enhance this with a dropdown)
				searchInput.setAttribute('list', 'folder-suggestions');
				let datalist = containerEl.querySelector('#folder-suggestions') as HTMLDataListElement;
				if (!datalist) {
					datalist = containerEl.createEl('datalist', { attr: { id: 'folder-suggestions' } });
				}
				datalist.empty();
				suggestions.forEach(folder => {
					datalist.createEl('option', { value: folder });
				});
			});
		});

		// Note Template - Full Width
		containerEl.createEl('h3', { text: 'Note Template' });
		containerEl.createEl('p', {
			text: 'Customize how event notes are created. Available placeholders:',
			cls: 'setting-item-description'
		});

		// Placeholder documentation
		const placeholderInfo = containerEl.createDiv('template-placeholders');
		placeholderInfo.style.marginBottom = '10px';
		placeholderInfo.style.padding = '10px';
		placeholderInfo.style.backgroundColor = 'var(--background-secondary)';
		placeholderInfo.style.borderRadius = '4px';
		placeholderInfo.style.fontSize = '12px';
		placeholderInfo.style.fontFamily = 'var(--font-monospace)';
		placeholderInfo.innerHTML = `
			<code>{{summary}}</code> - Event title<br>
			<code>{{date}}</code> - Event date<br>
			<code>{{start}}</code> / <code>{{end}}</code> - Start/end times<br>
			<code>{{location}}</code> - Event location<br>
			<code>{{description}}</code> - Event description<br>
			<code>{{attendees}}</code> - List of attendees<br>
			<code>{{attendees_links}}</code> - Attendees as wiki links (if matching notes exist)
		`;

		const templateContainer = containerEl.createDiv('template-container');
		templateContainer.style.marginBottom = '20px';

		const templateTextarea = templateContainer.createEl('textarea');
		templateTextarea.placeholder = EVENT_NOTE_TEMPLATE;
		templateTextarea.value = this.plugin.settings.eventNoteTemplate || EVENT_NOTE_TEMPLATE;
		templateTextarea.style.width = '100%';
		templateTextarea.style.minHeight = '300px';
		templateTextarea.style.padding = '10px';
		templateTextarea.style.border = '1px solid var(--background-modifier-border)';
		templateTextarea.style.borderRadius = '4px';
		templateTextarea.style.backgroundColor = 'var(--background-primary)';
		templateTextarea.style.color = 'var(--text-normal)';
		templateTextarea.style.fontSize = '13px';
		templateTextarea.style.fontFamily = 'var(--font-monospace)';
		templateTextarea.style.resize = 'vertical';
		templateTextarea.addEventListener('input', async (e) => {
			this.plugin.settings.eventNoteTemplate = (e.target as HTMLTextAreaElement).value;
			await this.plugin.saveSettings();
		});

		// Sync Settings Section
		containerEl.createEl('h2', { text: 'Sync Settings' });

		new Setting(containerEl)
			.setName('Refresh Interval')
			.setDesc('How often to check for new events (in minutes)')
			.addSlider(slider => slider
				.setLimits(5, 60, 5)
				.setValue(this.plugin.settings.refreshIntervalMinutes)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.refreshIntervalMinutes = value;
					await this.plugin.saveSettings();
				}))
			.addText(text => text
				.setValue(this.plugin.settings.refreshIntervalMinutes.toString())
				.onChange(async (value) => {
					const intValue = parseInt(value);
					if (!isNaN(intValue) && intValue >= 5 && intValue <= 60) {
						this.plugin.settings.refreshIntervalMinutes = intValue;
						await this.plugin.saveSettings();
					}
				}));

		// Actions Section
		containerEl.createEl('h2', { text: 'Actions' });

		new Setting(containerEl)
			.setName('Manual Refresh')
			.setDesc('Immediately refresh calendar data from all sources')
			.addButton(button => button
				.setButtonText('Refresh Now')
				.onClick(async () => {
					button.setDisabled(true);
					button.setButtonText('Refreshing...');
					await this.refreshCache();
					button.setButtonText('Done!');
					setTimeout(() => {
						button.setButtonText('Refresh Now');
						button.setDisabled(false);
					}, 2000);
				}));
	}
}
