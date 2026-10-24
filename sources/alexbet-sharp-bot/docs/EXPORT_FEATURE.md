# Export Feature Documentation

## Overview

The `/export` command allows users to download their latest +EV scan results in multiple formats (CSV, TXT, JSON). Files are automatically generated and stored on the server.

## Features

✅ **Multiple Export Formats**
- CSV: Excel/Google Sheets compatible
- TXT: Human-readable with formatting
- JSON: Structured data with metadata

✅ **Automatic Data Management**
- Scan results cached for 1 hour per user
- Old exports auto-cleanup (after 7 days)
- User-specific file isolation

✅ **Rich Content**
- Rank by edge%
- Sport breakdown
- Kelly sizing guide (TXT)
- Complete gem details

## User Workflow

### Step 1: Run a Scan
```
/scan
```

Results are automatically stored in memory for 1 hour.

### Step 2: Export the Results
```
/export
```

Bot shows available formats and instructions.

### Step 3: Choose Format

**For Excel/Sheets:**
```
/export_csv
```

**For Reading:**
```
/export_txt
```

**For Backup/Integration:**
```
/export_json
```

## File Formats

### CSV Format

Spreadsheet-ready with 13 columns:

```
rank,sport,market,pick,odds,edge_percent,ev_percent,implied_probability,kelly_percent,kelly_stake,conservative_2pct,best_book,books_compared
1,NFL,Moneyline,Kansas City Chiefs ML,-110,5.25,4.77,N/A,0.03,2.5,N/A,N/A,5
2,NBA,Spread,Boston Celtics -5.5,-105,3.75,3.57,N/A,0.02,1.8,N/A,N/A,5
```

**Filename:** `alexbet-scan-{userId}-{YYYY-MM-DD}.csv`

**Best For:**
- Pivot tables
- Filtering/sorting
- Integration with other tools
- Long-term record keeping

### TXT Format

Human-readable with ASCII formatting:

```
╔════════════════════════════════════════════════════════════════════════╗
║             AlexBET SHARP BOT - +EV SCAN RESULTS                       ║
║             Generated: 4/18/2026, 5:09:20 PM                        ║
╚════════════════════════════════════════════════════════════════════════╝

📊 SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Gems Found: 2
Export Date: 2026-04-19
Export Time: 00:09:20

📈 BREAKDOWN BY SPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NFL: 1 gems
NBA: 1 gems

💎 DETAILED RESULTS (Ranked by Edge %)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─ #1 ────────────────────────────────────────────────────────────┐
│ Sport: NFL      Market: Moneyline    Pick: Kansas City Chiefs ML │
│ Odds: -110     Book: N/A             Books: 5             │
│ Edge: 5.25%       EV: 4.77% │
│ Kelly: 0.03% (2.5 stake) | Implied: N/A% │
│ Conservative 2%: N/A                                │
└────────────────────────────────────────────────────────────────────┘
```

**Filename:** `alexbet-scan-{userId}-{YYYY-MM-DD}.txt`

**Best For:**
- Quick review
- Printing
- Email sharing
- Mobile reading (displays well on any device)

### JSON Format

Structured data with metadata:

```json
{
  "metadata": {
    "exportDate": "2026-04-19T00:09:20.123Z",
    "userId": 12345,
    "totalGems": 2,
    "version": "2.0"
  },
  "gems": [
    {
      "rank": 1,
      "sport": "NFL",
      "market": "Moneyline",
      "pick": "Kansas City Chiefs ML",
      "odds": "-110",
      "edge_percent": "5.25",
      "ev_percent": "4.77",
      ...
    }
  ],
  "summary": {
    "totalGemsFound": 2,
    "avgEdge": "4.50",
    "sports": ["NFL", "NBA"]
  }
}
```

**Filename:** `alexbet-scan-{userId}-{YYYY-MM-DD}.json`

**Best For:**
- API integration
- Backup/archival
- Data analysis scripts
- Programmatic processing

## Implementation Details

### Storage Location
```
/home/pil_coder1/projects/alexbet-sharp-bot/exports/
```

### In-Memory Cache
User scans stored in `userLatestScans` object:
```javascript
userLatestScans[userId] = {
  gems: [...],           // Array of gem objects
  timestamp: Date.now(), // When the scan was performed
  count: 123,           // Total gems in scan
  date: ISO8601         // Formatted date
}
```

**Auto-Cleanup:** Every hour, scans older than 1 hour are deleted.

### File Export Flow

1. User calls `/export` → Show format menu
2. User calls `/export_csv`, `/export_txt`, or `/export_json`
3. Bot retrieves cached gems from `userLatestScans[userId]`
4. Export handler converts gems to chosen format
5. File written to `/exports` directory
6. Bot sends confirmation with filename & size
7. File persists for 7 days (manual cleanup can be scheduled)

## Testing

Run comprehensive export tests:

```bash
npm test -- test/export-handler.test.js
```

Tests verify:
- ✅ CSV export with proper formatting
- ✅ TXT export with ASCII formatting
- ✅ JSON export with valid structure
- ✅ Error handling for empty gems
- ✅ File persistence on disk

**Result:** 5/5 tests passing ✅

## Error Handling

### No Recent Scan
```
❌ No recent scan found.

Run /scan first, then export the results.
```

### Export Timeout
```
❌ Export failed: [specific error]
```

### Empty Gems
Automatically handled - no empty files created.

## Future Enhancements

1. **Web Dashboard** - Download files via web interface
2. **Email Delivery** - Send exports to user email
3. **Scheduled Exports** - Daily auto-export at set time
4. **Excel Formatting** - Add charts & conditional formatting
5. **PDF Reports** - Professional PDF with branding
6. **Database Logging** - Track which exports users download
7. **S3 Upload** - Store in cloud storage instead of server

## API Reference

### Export Handler Module

```javascript
const {
  exportToCSV,      // (gems, userId) => {filepath, filename, size, gemsCount}
  exportToTXT,      // (gems, userId) => {filepath, filename, size, gemsCount}
  exportToJSON,     // (gems, userId) => {filepath, filename, size, gemsCount}
  getAvailableExports, // (userId) => [list of user files]
  cleanupOldExports, // (maxAgeDays = 7) => void
  EXPORTS_DIR       // String - path to exports directory
} = require('./src/utils/export-handler');
```

### Example Usage

```javascript
const { exportToCSV } = require('./src/utils/export-handler');

const gems = [
  {
    sport: 'NFL',
    betType: 'Moneyline',
    pick: 'KC Chiefs',
    odds: -110,
    edge: 5.5,
    ev: 5.0,
    kelly: 2.5,
    game: 'KC vs PIT',
    gameTime: '20:20 ET'
  }
];

const result = exportToCSV(gems, 12345);
// Returns:
// {
//   filepath: '/path/to/exports/alexbet-scan-12345-2026-04-19.csv',
//   filename: 'alexbet-scan-12345-2026-04-19.csv',
//   size: 348,
//   gemsCount: 1,
//   format: 'csv'
// }
```

## Logging

All export operations are logged with Winston:

```
17:09:13 [info] CSV export created {
  "service": "alexbet-bot",
  "userId": 12345,
  "filename": "alexbet-scan-12345-2026-04-19.csv",
  "gemsCount": 3,
  "fileSize": 348
}
```

Check logs:
```bash
tail -f logs/combined.log
```
