# Advanced Chart

A professional-grade trading chart built from scratch in **vanilla JavaScript** — no charting libraries, no frameworks. Designed to outperform Lightweight Charts in features, extensibility, and rendering quality.

> **Status:** v0.1 — Chart engine + drawing system complete. Indicators and advanced tools are planned for v0.2.

---

## Why another chart library?

Most open-source charting libraries (Lightweight Charts, Chart.js, etc.) trade extensibility for performance. This project proves you can have **both**:

- **Modular architecture** — every concern is a separate file: rendering, data, scales, drawing, UI.
- **Thousands of drawings** — spatial indexing + visible-range culling keeps the canvas fast even with 10k+ objects on screen.
- **Pixel-perfect rendering** — high-DPI canvas with proper device-pixel-ratio handling, sub-pixel alignment, and adaptive detail (candles → high-low bars → close line as you zoom out).
- **Touch-first** — pinch-zoom, two-finger pan, and full mobile responsiveness out of the box.
- **Zero dependencies** — just open `index.html` in a browser.

---

## Quick start

```bash
cd advanced-chart
# Any static server works. Pick one:
python3 -m http.server 8000
#   → open http://localhost:8000

# Or:
npx serve .
```

No build step. No npm install. Just open it.

---

## Architecture

```
advanced-chart/
├── index.html               # Entry point
├── css/
│   ├── main.css             # Base reset + CSS variables
│   ├── chart.css            # Canvas overlay, tooltip, legend, status bar
│   ├── toolbar.css          # Toolbar buttons & responsive layout
│   └── themes.css           # Light theme overrides
└── js/
    ├── app.js               # Bootstrap
    ├── core/
    │   ├── ChartEngine.js   # Orchestrator — owns all subsystems
    │   ├── Canvas.js        # High-DPI canvas + ResizeObserver
    │   ├── Viewport.js      # Visible range, pan/zoom math
    │   ├── EventManager.js  # Pointer/touch/wheel/keyboard
    │   └── AnimationLoop.js # rAF + dirty-flag scheduling
    ├── data/
    │   ├── Candle.js        # Candle type
    │   ├── DataManager.js   # Flat Float64Array storage (cache-friendly)
    │   └── DataFeed.js      # Simulated market feed (replace with WS/REST)
    ├── scale/
    │   ├── PriceScale.js    # Y-axis with nice ticks + last-price tag
    │   └── TimeScale.js     # X-axis with adaptive time formatting
    ├── series/
    │   ├── SeriesBase.js    # Base class for all series
    │   ├── CandleSeries.js  # Candlesticks with adaptive detail
    │   └── VolumeSeries.js  # Volume bars + MA
    ├── drawing/
    │   ├── DrawingBase.js   # Base class — anchors, hit-test, lifecycle
    │   ├── DrawingManager.js# Manages thousands of drawings + spatial index
    │   ├── TrendLine.js     # 2-point line with extension + price labels
    │   ├── HorizontalLine.js# Price level line
    │   ├── Rectangle.js     # Zone highlighter
    │   ├── Fibonacci.js     # Fib retracement with 9 levels
    │   └── TextDrawing.js   # Text annotation
    ├── ui/
    │   ├── Toolbar.js       # Tools + intervals + actions
    │   ├── Crosshair.js     # Crosshair + axis labels
    │   ├── Tooltip.js       # OHLCV floating tooltip
    │   ├── Legend.js        # Symbol + price + change
    │   ├── StatusBar.js     # Cursor coords + FPS + counts
    │   └── Theme.js         # Dark/Light theme manager
    └── utils/
        ├── MathUtils.js     # niceNumber, lerp, format, clamp...
        ├── ColorUtils.js    # Hex/rgba, gradients, alpha
        ├── DomUtils.js      # el(), clear(), fullscreen
        └── Performance.js   # FPS counter
```

### Rendering pipeline (per frame)

1. **Background fill**
2. **Volume bars** (lower pane)
3. **Price scale** (Y-axis + horizontal gridlines)
4. **Time scale** (X-axis + vertical gridlines)
5. **Candles** (adaptive: full bodies → high-low bars → close line)
6. **Drawings** (z-sorted, visible-range culled)
7. **Crosshair** + axis labels
8. **DOM overlays** (tooltip, legend, status bar)

The render loop uses a **dirty flag + rAF coalescing** — the chart does **zero work** when idle. CPU usage drops to 0% when nothing is moving.

---

## Performance design

### Data storage
`DataManager` uses parallel `Float64Array` buffers (`times`, `opens`, `highs`, `lows`, `closes`, `volumes`) instead of an array of objects. This is dramatically more cache-friendly when scanning thousands of bars for the visible high/low range, and avoids GC pressure from object allocation.

### Adaptive rendering
`CandleSeries` picks the rendering mode based on zoom level:

| `barSpacing` | Mode | Cost |
|---|---|---|
| > 4 px | Full candle bodies + wicks | 3 Path2D batches |
| 1.5–4 px | High-low bars (no bodies) | 1 fill per bar |
| < 1.5 px | Close-price line | 1 stroke |

You can have **10,000+ bars** loaded and still pan/zoom at 60 FPS.

### Drawing spatial index
`DrawingManager` buckets each drawing's anchors by bar-index into a `Map<bucketKey, Set<drawingId>>`. Hit-testing only considers drawings in the 3 buckets around the cursor — O(1) instead of O(n).

### Visible-range culling
Before rendering, drawings whose anchors are all outside the visible range are skipped entirely. This means panning around with 5,000 drawings on the chart costs the same as panning with 50.

---

## Built-in tools

| Tool | Shortcut | Behavior |
|---|---|---|
| Cursor | `V` | Default — pan with click-drag, select drawings |
| Crosshair | `C` | Snap-to-bar crosshair |
| Trend Line | `T` | 2-click line with optional extension |
| Horizontal Line | `H` | Single-click price level |
| Rectangle | `R` | 2-click zone |
| Fibonacci | `F` | 2-click retracement (0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618) |
| Text | `X` | Click to place annotation |

**Other shortcuts:** `Delete`/`Backspace` removes the selected drawing. `Esc` cancels the in-progress drawing.

---

## API quick reference

```js
const engine = new ChartEngine(container, { symbol: 'BTCUSDT', theme: 'dark' });
engine.init();                                  // load history + fit view

engine.setActiveTool('trendline');              // activate a drawing tool
engine.fitAll();                                // fit all data in view
engine.zoomBy(1.25);                            // zoom in (factor > 1)
engine.toggleTheme();                           // dark ↔ light
engine.toggleLive();                            // start/stop simulated feed
engine.setInterval('15m');                      // change bar interval

engine.dataManager.size;                        // → 1500
engine.drawingManager.count;                    // → 7
engine.drawingManager.clear();                  // remove all drawings
engine.destroy();                               // teardown
```

---

## Roadmap

- [ ] **v0.2** — Indicators framework (SMA, EMA, RSI, MACD, Bollinger Bands)
- [ ] **v0.3** — Multi-pane support (separate indicator panes below price)
- [ ] **v0.4** — Real data adapters (Binance WebSocket, REST history)
- [ ] **v0.5** — Drawing editing (drag handles, snap-to-candle, magnet mode)
- [ ] **v0.6** — Object tree panel + save/load layouts
- [ ] **v0.7** — Replay mode (bar-by-bar playback of historical data)
- [ ] **v1.0** — Plugin system for custom indicators & drawings

---

## License

MIT
