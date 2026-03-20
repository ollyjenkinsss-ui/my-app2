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
   http://localhost:3000/index.html
   ```

The backend proxy server runs on port 3000 and bypasses CORS restrictions to fetch data from external APIs.

## How It Works

- **Frontend**: Pure HTML/CSS/JavaScript
- **Backend**: Express.js proxy server to bypass CORS
- **Data Sources**:
  - Riot Data Dragon API (champion data, abilities, items)
  - OP.GG Internal API (live stats, builds, runes, matchups)

## Files

- `index.html` - Main champion list and details page
- `patch-notes.html` - Patch notes page
- `newest-champion.html` - Newest champion showcase
- `server.js` - Backend proxy server
- `package.json` - Node.js dependencies
- `page-transitions.js` - Page transition animations

## Troubleshooting

If you see "No data available":
1. Make sure the backend server is running (`npm start`)
2. Check the browser console (F12) for errors
3. Verify you're accessing via `http://localhost:3000` not `file://`
