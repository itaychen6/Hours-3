# Hours 3

A Figma plugin for automatic time tracking of files and pages.

## Features

- **Automatic File/Page Tracking**: Automatically detects which Figma file and page is active
- **Seamless File Switching**: Pauses timers when switching files and resumes when returning
- **Organized Time Data**: Displays tracked time for each file and page in a hierarchical view
- **Offline Support**: Works even without internet connection, with data synced later
- **Firebase Integration**: Cloud storage for time tracking data
- **Visual Indicators**: Clear visual cues for which files and pages are being tracked
- **Inactivity Detection**: Automatically pauses tracking after 5 minutes of inactivity

## How It Works

1. The plugin automatically starts tracking time when you open a file in Figma
2. When you switch to a different file, the timer for the current file pauses
3. When you return to a previously tracked file, its timer resumes
4. All tracked files and their pages are displayed in a list with their total time

## Development

This plugin is built with:
- TypeScript
- Firebase Realtime Database
- Figma Plugin API

To build the project:
```
npm run build
```

## License

MIT