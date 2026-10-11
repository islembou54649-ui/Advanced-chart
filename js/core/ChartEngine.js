/**
 * ChartEngine.js
 * The main orchestrator. Owns all subsystems and runs the render loop.
 *
 * Responsibilities:
 * 1. Set up canvas + DOM structure
 * 2. Wire EventManager → Viewport → render pipeline
 * 3. Render order: background → grid → series → drawings → crosshair → axes → overlays
 * 4. Coordinate updates from data feed → re-render
 * 5. Public API for tools, intervals, theme, etc.
 */
import { Canvas } from './Canvas.js';
import { Viewport } from './Viewport.js';
import { EventManager } from './EventManager.js';
import { AnimationLoop } from './AnimationLoop.js';

import { DataManager } from '../data/DataManager.js';
import { DataFeed } from '../data/DataFeed.js';

import { PriceScale } from '../scale/PriceScale.js';
import { TimeScale } from '../scale/TimeScale.js';

import { CandleSeries } from '../series/CandleSeries.js';
import { VolumeSeries } from '../series/VolumeSeries.js';

import { Crosshair } from '../ui/Crosshair.js';
import { Tooltip } from '../ui/Tooltip.js';
import { Legend } from '../ui/Legend.js';
import { StatusBar } from '../ui/StatusBar.js';
import { Toolbar } from '../ui/Toolbar.js';
import { ThemeManager } from '../ui/Theme.js';
import { DrawingManager } from '../drawing/DrawingManager.js';
import { Performance } from '../utils/Performance.js';
import { DomUtils } from '../utils/DomUtils.js';

export class ChartEngine {
    constructor(container, options = {}) {
        this.container = container;
        this.symbol = options.symbol || 'BTCUSDT';
        this.options = options;

        // Theme
        this.themeManager = new ThemeManager(options.theme || 'dark');
        this.theme = this.themeManager.get();

        // Root DOM structure
        this.root = DomUtils.el('div', { class: 'ac-root' });
        container.appendChild(this.root);
        this.toolbarContainer = DomUtils.el('div', { class: 'ac-toolbar-container' });
        this.chartContainer = DomUtils.el('div', { class: 'ac-chart-container' });
        this.canvasContainer = DomUtils.el('div', { class: 'ac-canvas-container' });
        this.overlayContainer = DomUtils.el('div', { class: 'ac-overlay-container' });
        this.statusContainer = DomUtils.el('div', { class: 'ac-status-container' });
        this.chartContainer.appendChild(this.canvasContainer);
        this.chartContainer.appendChild(this.overlayContainer);
        this.root.append(this.toolbarContainer, this.chartContainer, this.statusContainer);

        // Canvas (the main drawing surface)
        this.canvas = new Canvas(this.canvasContainer, { alpha: false });
        this.canvas.onResize = (w, h) => this._onResize(w, h);

        // Data
        this.dataManager = new DataManager(10000);
        this.viewport = new Viewport();
        this.viewport._dm = this.dataManager;

        // Data feed
        this.dataFeed = new DataFeed(this.dataManager, {
            startPrice: 50000,
            volatility: 0.012,
            drift: 0.0001,
            interval: 60_000
        });

        // Scales
        this.priceScale = new PriceScale();
        this.timeScale = new TimeScale();

        // Series
        this.candleSeries = new CandleSeries();
        this.volumeSeries = new VolumeSeries();

        // Drawing manager
        this.drawingManager = new DrawingManager();
        this.drawingManager._viewport = this.viewport;
        this.activeTool = null;

        // UI overlays
        this.crosshair = new Crosshair();
        this.tooltip = new Tooltip(this.overlayContainer);
        this.legend = new Legend(this.overlayContainer);
        this.statusBar = new StatusBar(this.statusContainer);
        this.toolbar = new Toolbar(this.toolbarContainer, this);

        // Performance
        this.perf = new Performance();
        this.perf.enabled = true;

        // Render loop
        this.loop = new AnimationLoop(() => this._render());

        // Events
        this.eventManager = new EventManager(this.canvas, this);

        // Initial state
        this._liveMode = false;
        this._fpsCounter = 0;
        this._fpsTimer = setInterval(() => {
            this.statusBar.setFps(this.perf.fps);
        }, 500);

        // Theme change subscription
        this.themeManager.subscribe((theme) => {
            this.theme = theme;
            this.root.classList.toggle('ac-theme-light', theme.name === 'light');
            this.requestRender();
        });
        this.root.classList.toggle('ac-theme-light', this.theme.name === 'light');

        // Initial size + first render
        this._onResize(this.canvas.cssWidth, this.canvas.cssHeight);
    }

    /**
     * Generate historical data and fit the view.
     */
    init() {
        this.dataFeed.generateHistory(1500);
        this.viewport.fitRange(150, 10);
        this.viewport.updatePriceRange(this.dataManager);
        this.statusBar.setBars(this.dataManager.size);
        this.statusBar.setDrawings(0);
        this.legend.update(this.symbol, this.dataManager, this.theme);
        this.requestRender();
    }

    _onResize(w, h) {
        // Subtract toolbar (~44px) and status bar (~22px) — handled by CSS flex layout.
        // Canvas container already gets the right size from CSS.
        const width = Math.max(100, w);
        const height = Math.max(100, h);
        this.viewport.setSize(width, height, 0.18);
        this.viewport.updatePriceRange(this.dataManager);
        // Crosshair needs to know axis widths/heights
        this.crosshair._priceScaleWidth = this.priceScale.width;
        this.crosshair._timeScaleHeight = this.timeScale.height;
        this.requestRender();
    }

    /**
     * Public API: request a re-render.
     */
    requestRender() {
        this.loop.requestRender();
    }

    /**
     * The main render function. Called by the animation loop when dirty.
     */
    _render() {
        this.perf.beginRender();
        const ctx = this.canvas.getContext();
        const theme = this.theme;

        // Update price range from visible data
        this.viewport.updatePriceRange(this.dataManager);

        // 1. Clear background
        ctx.fillStyle = theme.chartBg;
        ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);

        // 2. Volume pane (drawn first so candles overlay on top)
        this.volumeSeries.draw(ctx, this.viewport, this.dataManager, theme);

        // 3. Price grid (rendered by PriceScale.draw which draws gridlines)
        this.priceScale.draw(ctx, this.viewport, theme);

        // 4. Time grid (rendered by TimeScale.draw)
        this.timeScale.draw(ctx, this.viewport, this.dataManager, theme);

        // 5. Candles
        this.candleSeries.draw(ctx, this.viewport, this.dataManager, theme);

        // 6. Drawings (above candles)
        this.drawingManager.draw(ctx, this.viewport, theme);

        // 7. Crosshair
        this.crosshair.draw(ctx, this.viewport, this.dataManager, theme);

        // 8. Update overlay DOM (tooltip + legend)
        const pointerIdx = this.eventManager.pointerInside
            ? Math.round(this.viewport.xToIndex(this.eventManager.pointerX - this.viewport.barSpacing / 2))
            : -1;
        this.tooltip.update(
            MathUtils_clampIdx(pointerIdx, this.dataManager.size),
            this.dataManager,
            this.viewport,
            this.eventManager.pointerInside
        );
        this.legend.update(this.symbol, this.dataManager, theme);

        // 9. Status bar updates
        if (this.eventManager.pointerInside) {
            const price = this.viewport.yToPrice(this.eventManager.pointerY);
            this.statusBar.setCursor(price, pointerIdx);
        }
        this.statusBar.setDrawings(this.drawingManager.count);
        this.statusBar.setBars(this.dataManager.size);

        this.perf.endRender();
        this.perf.tick();
    }

    // ---- Public API methods ----
    setActiveTool(tool) {
        this.activeTool = tool;
        this.drawingManager.setActiveTool(tool);
        this.toolbar.setActiveTool(tool);
        this.requestRender();
    }

    zoomBy(factor) {
        this.viewport.zoomAt(this.viewport.width / 2, factor);
        this.viewport.updatePriceRange(this.dataManager);
        this.requestRender();
    }

    fitAll() {
        if (this.dataManager.size === 0) return;
        this.viewport.fitRange(this.dataManager.size, 5);
        this.viewport.updatePriceRange(this.dataManager);
        this.requestRender();
    }

    toggleTheme() {
        this.themeManager.toggle();
    }

    toggleLive() {
        if (this._liveMode) {
            this.dataFeed.stop();
            this._liveMode = false;
            document.getElementById('ac-live-btn')?.classList.remove('active');
        } else {
            this.dataFeed.start(1500);
            this._liveMode = true;
            document.getElementById('ac-live-btn')?.classList.add('active');
            // Auto-scroll to follow new data
            this._followInterval = setInterval(() => {
                if (this.dataManager.size > 0) {
                    const rightEdge = this.viewport.rightEdge;
                    const lastIdx = this.dataManager.size - 1;
                    // If user is near the right edge, keep following
                    if (rightEdge >= lastIdx - 5) {
                        this.viewport.scrollToRight(this.dataManager.size);
                        this.viewport.updatePriceRange(this.dataManager);
                        this.requestRender();
                    }
                }
            }, 800);
        }
    }

    setInterval(iv) {
        const intervals = {
            '1m': 60_000, '5m': 5 * 60_000, '15m': 15 * 60_000,
            '1h': 60 * 60_000, '4h': 4 * 60 * 60_000,
            '1D': 24 * 60 * 60_000, '1W': 7 * 24 * 60 * 60_000
        };
        const ms = intervals[iv];
        if (!ms) return;
        const wasLive = this._liveMode;
        if (wasLive) this.dataFeed.stop();
        this.dataFeed.interval = ms;
        this.dataManager.interval = ms;
        this.dataFeed.generateHistory(1500);
        this.viewport.fitRange(150, 10);
        this.viewport.updatePriceRange(this.dataManager);
        this.statusBar.setBars(this.dataManager.size);
        this.requestRender();
        if (wasLive) this.dataFeed.start(1500);
    }

    destroy() {
        clearInterval(this._fpsTimer);
        clearInterval(this._followInterval);
        this.dataFeed.stop();
        this.loop.stop();
        this.eventManager.destroy();
        this.canvas.destroy();
        this.root.remove();
    }
}

// Local helper (avoid extra import for a tiny clamp)
function MathUtils_clampIdx(idx, size) {
    if (idx < 0 || idx >= size) return -1;
    return idx;
}
