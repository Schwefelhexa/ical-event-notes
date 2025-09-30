# iCal Event Notes

An Obsidian plugin that syncs your calendar events and creates structured meeting notes with a single command.

![Screenshot: Plugin settings showing calendar sources](placeholder-settings.png)

## Features

### Calendar Integration

- **Multiple Calendar Support**: Connect unlimited iCal/ICS calendar sources (Google Calendar, Outlook, CalDAV, etc.)
- **Automatic Sync**: Fetches events at configurable intervals (5-60 minutes) and on window focus
- **Recurring Events**: Full support for recurring events with proper expansion of event series
- **Smart Event Filtering**: Shows only relevant events (currently active, upcoming in next 24h, or recently ended within 1h)

### Quick Note Creation

- **One-Command Access**: Use the command palette to instantly see and create notes from relevant events
- **Smart Event Selection**: Events are sorted by relevance — ongoing events appear first, followed by upcoming and recently ended ones
- **Duplicate Prevention**: Automatically opens existing event notes instead of creating duplicates

![Screenshot: Event selection modal showing upcoming meetings](placeholder-event-modal.png)

### Intelligent Participant Linking

One of the most powerful features: automatically links meeting participants to existing notes in your vault.

- **Email-to-Note Matching**: Recognizes when `john.doe@example.com` corresponds to your `@John Doe` note
- **Alias Support**: Checks both filenames and frontmatter aliases for matches
- **Flexible Matching**: Tries multiple variations (full name, @-prefixed name, email) to find the best match
- **Graceful Fallback**: Shows plain text for unrecognized participants

Example: If you have a note at `People/@John Doe.md` with the alias `john.doe@example.com` in its frontmatter, the plugin will automatically link to `[[@John Doe]]` if `john.doe@example.com` was invited to the event.

### Customizable Templates

- **Full Template Control**: Customize the structure and content of generated event notes
- **Rich Placeholders**: Access event data including:
  - `{{summary}}` - Event title
  - `{{date}}` - Event date
  - `{{start}}` / `{{end}}` - Start and end times
  - `{{location}}` - Event location
  - `{{description}}` - Full event description
  - `{{attendees}}` - Plain text list of participants
  - `{{attendees_links}}` - Auto-linked participants (uses intelligent matching)
- **Filename Generation**: Creates clean, filesystem-safe filenames with date prefixes (e.g., `2024-03-15 — Team Standup.md`)

![Screenshot: Template editor showing available placeholders](placeholder-template-editor.png)

### Organized Note Storage

- **Configurable Location**: Choose where event notes are saved in your vault
- **Folder Autocomplete**: Built-in folder picker with suggestions from your vault structure
- **Auto-Create Directories**: Target folders are created automatically if they don't exist

## Installation

### From Obsidian Community Plugins (Recommended)

1. Open Obsidian Settings
2. Navigate to Community Plugins and disable Safe Mode
3. Click Browse and search for "iCal Event Notes"
4. Click Install, then Enable

### Manual Installation

1. Download the latest release from the [releases page](https://github.com/Schwefelhexa/ical-event-notes/releases)
2. Extract the files into your vault's `.obsidian/plugins/ical-event-notes/` directory
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

## Setup

### 1. Add Calendar Sources

1. Open Settings → iCal Event Notes
2. Click "+ Add Calendar"
3. Enter a name for your calendar
4. Paste your calendar's iCal/ICS URL

**Where to find calendar URLs:**

- **Google Calendar**: Calendar Settings → Integrate Calendar → Secret address in iCal format
- **Outlook/Office 365**: Calendar Settings → Shared Calendars → Publish → ICS link
- **Apple Calendar**: File → Export → Save as .ics, then host the file or use a CalDAV URL

### 2. Configure Note Location (Optional)

Choose where event notes should be created. Default is your vault root (`/`).

Examples: `/Events/`, `/Calendar/2024/`, `/Meetings/`

### 3. Customize Template (Optional)

Modify the template to match your note-taking style. The default template includes frontmatter for event metadata and a basic structure.

### 4. Set Up Participant Linking (Optional)

To enable automatic linking of meeting participants:

1. Create notes for your contacts (e.g., `@John Doe.md`)
2. Add email addresses as aliases in the frontmatter:
   ```md
   ---
   aliases:
     - john.doe@example.com
     - jdoe@company.com
   ---
   ```
3. Use `{{attendees_links}}` in your template

## Usage

### Creating Event Notes

1. Open the command palette (`Cmd/Ctrl + P`)
2. Run "iCal Event Notes: Create/Open Note from Event"
3. Select an event from the list
4. A new note is created and opened (or existing note is opened if it already exists)

![Screenshot: Completed event note showing linked participants and metadata](placeholder-event-note.png)

### Refreshing Calendar Data

**Automatic**: The plugin refreshes automatically:
- Every X minutes (configurable, default 15)
- When you focus the Obsidian window

**Manual**:
- Command palette: "iCal Event Notes: Reload Calendar"
- Settings panel: Click "Refresh Now" button

## Settings Reference

| Setting | Description | Default |
|---------|-------------|---------|
| Calendar Sources | List of iCal/ICS URLs to sync | None |
| Notes Location | Vault folder for event notes | `/` (root) |
| Note Template | Markdown template for new notes | Included default |
| Refresh Interval | Minutes between automatic syncs | 15 |

## Template Variables

All available placeholders for customizing your note template:

| Variable | Description | Example Output |
|----------|-------------|----------------|
| `{{summary}}` | Event title | "Team Standup" |
| `{{date}}` | Event date | "3/15/2024" |
| `{{start}}` | Start date and time | "3/15/2024, 10:00:00 AM" |
| `{{end}}` | End date and time | "3/15/2024, 10:30:00 AM" |
| `{{location}}` | Event location | "Conference Room A" |
| `{{description}}` | Full event description | (Full text from calendar) |
| `{{attendees}}` | Plain text attendee list | "John Doe, Jane Smith" |
| `{{attendees_links}}` | Auto-linked attendees | "[[@John Doe]], [[@Jane Smith]]" |

## Tips & Tricks

- **Mobile Support**: The plugin works on mobile, but automatic refresh is disabled to preserve battery life
- **Recurring Meetings**: Each occurrence of a recurring event gets a unique note with the appropriate date
- **Private URLs**: Your calendar URLs are stored locally in Obsidian settings—they're never sent anywhere except to your calendar provider
- **Bulk Setup**: You can add multiple calendar sources to aggregate events from work, personal, and shared calendars

## Troubleshooting

**Events aren't showing up:**
- Verify your calendar URL is correct and accessible
- Check that events fall within the relevance window (1 hour ago to 24 hours ahead)
- Manually refresh using the command or settings button
- Check the console for any error messages

**Participant linking isn't working:**
- Ensure the contact note exists in your vault
- Verify the email is listed in the note's frontmatter aliases (case-insensitive matching)
- Try both `name@domain.com` and `@Name` formats as aliases

**Mobile sync issues:**
- Automatic refresh on interval is disabled on mobile—use manual refresh or pull-to-focus

## Privacy & Security

- Calendar URLs and cached event data are stored locally in your Obsidian vault
- The plugin only communicates with the calendar URLs you provide
- No data is sent to third-party services
- Calendar URLs may contain secret tokens—treat them like passwords

## Support & Development

- **Issues**: [GitHub Issues](https://github.com/Schwefelhexa/ical-event-notes/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/Schwefelhexa/ical-event-notes/discussions)
- **Source Code**: [GitHub Repository](https://github.com/Schwefelhexa/ical-event-notes)

## License

0BSD License - See LICENSE file for details

## Credits

Built with [ts-ics](https://github.com/Schedule-it/ts-ics) for iCal parsing.

---

**Enjoyed this plugin?** Consider starring the repository or sharing it with fellow Obsidian users!
