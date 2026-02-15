# Hilal-liqo Moon Sighting Dashboard

Interactive global hilal (crescent moon) visibility dashboard for Ramadan and Islamic calendar sighting.

**Hilalliqo** is a wordplay from "hilal" (crescent moon) and "liqo" (see again) — a tool to help observers worldwide track when the new moon becomes visible.

## Features

- **Global Visibility Map**: Interactive map showing hilal visibility predictions worldwide using the Yallop criteria
- **Islamic Calendar**: Displays current Islamic date with Ramadan countdown
- **Weather Integration**: Real-time weather data and precipitation radar overlay
- **Moon Visualization**: NASA moon phase images based on date and hemisphere
- **Qibla Direction**: Calculates qibla bearing for any location
- **2D/3D Map Modes**: Switch between flat and perspective map views
- **Export**: Save map snapshots as PNG

## Tech Stack

- React + Vite
- MapLibre GL for interactive mapping
- H3.js for hexagonal grid system
- astronomy-engine for astronomical calculations
- Tailwind CSS for styling

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Visibility Criteria (Yallop)

| Code | Description |
|------|-------------|
| A | Hilal easily visible |
| B | Hilal visible under perfect conditions |
| C | May need optical aid to find crescent |
| D | Will need optical aid to find crescent |
| E | Crescent not visible with telescope |
| F | Below Danjon limit (7°) |
| G | Sunset before new moon |
| H | No moonset |
| I | Moonset before sunset |

## License

MIT

## Author

[github.com/danylaksono](https://github.com/danylaksono)
