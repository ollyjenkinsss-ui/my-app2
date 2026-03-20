# League of Legends Champion Info App

A web application that displays League of Legends champion information including abilities, stats, builds, runes, and matchups.

## Features

- Champion list with search and pagination
- Champion abilities and details from Riot's Data Dragon API
- Win/Pick/Ban rates from Mobalytics
- Recommended builds and runes
- Best/Worst matchups
- Dark/Light mode toggle

## Setup Instructions

### Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)

### Installation

1. Open a terminal in the project directory
2. Install dependencies:
   ```bash
   npm install
   ```

### Running the Application

1. Start the backend proxy server:
   ```bash
   npm start
   ```

2. Open your browser and navigate to:
   ```
   http://localhost:3001/
   ```

The backend proxy server runs on port 3001 and bypasses CORS restrictions to fetch data from external APIs.

## How It Works

- **Frontend**: Pure HTML/CSS/JavaScript
- **Backend**: Express.js proxy server to bypass CORS
- **Data Sources**:
  - Riot Data Dragon API (champion data, abilities, items)
  - OP.GG Internal API (live stats, builds, runes, matchups)

## Files

- `pages/` - All HTML pages (`index.html`, `items.html`, `match-history.html`, etc.)
- `assets/js/` - Frontend scripts (`app.js`, `page-transitions.js`, etc.)
- `assets/css/style.css` - Main stylesheet
- `data/lp-cache.json` - LP cache storage
- `scripts/generate-static-snapshot.js` - Static snapshot generator
- `server.js` - Backend proxy server
- `package.json` - Node.js dependencies

## Troubleshooting

If you see "No data available":
1. Make sure the backend server is running (`npm start`)
2. Check the browser console (F12) for errors
3. Verify you're accessing via `http://localhost:3001` not `file://`
