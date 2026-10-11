/**
 * ChartEngine.js
 * The main orchestrator. Owns all subsystems and runs the render loop.
 *
 * Render order per frame:
 *   MAIN PANE:
 *     1. Background
 *     2. Volume bars (lower portion)
 *     3. Price grid + Y-axis labels (PriceScale)
 *     4. Time grid + X-axis labels (TimeScale)
 *     5. Candles (clipped to chart area, NOT under price axis)
 *     6. Overlay indicators
 *     7. Drawings (clipped)
 *     8. Crosshair
 *   INDICATOR PANES (below main):
 *     For each pane: background → gridlines → indicator drawings → axis labels
 *   DOM overlays: tooltip, legend, settings card, status bar
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
import { Crosshair } from '../ui/Crosshair.js';
import { Tooltip } from '../ui/Tooltip.js';
import { Legend } from '../ui/Legend.js';
import { StatusBar } from '../ui/StatusBar.js';
import { Toolbar } from '../ui/Toolbar.js';
import { ThemeManager } from '../ui/Theme.js';
import { DrawingManager } from '../drawing/DrawingManager.js';
import { DrawingSettingsCard } from '../ui/DrawingSettingsCard.js';
import { IndicatorManager } from '../indicators/IndicatorManager.js';
import { Performance } from '../utils/Performance.js';
import { DomUtils } from '../utils/DomUtils.js';

export class ChartEngine {
    constructor(container, options = {}) {
        this.container = container;
        this.symbol = options.symbol || 'BTCUSDT';
        this.options = options;

        this.themeManager = new ThemeManager(options.theme || 'dark');
        this.theme = this.themeManager.get();

        // Root DOM
        this.root = DomUtils.el('div', { class: 'ac-root' });
        container.appendChild(this.root);
        this.toolbarContainer = DomUtils.el('div', { class: 'ac-toolbar-container' });
        this.chartArea = DomUtils.el('div', { class: 'ac-chart-area' });
        this.paneContainer = DomUtils.el('div', { class: 'ac-pane-container' });
        this.overlayContainer = DomUtils.el('div', { class: 'ac-overlay-container' });
        this.statusContainer = DomUtils.el('div', { class: 'ac-status-container' });
        this.chartArea.appendChild(this.paneContainer);
        this.chartArea.appendChild(this.overlayContainer);
        this.root.append(this.toolbarContainer, this.chartArea, this.statusContainer);

        // Main canvas (created inside main pane by PaneManager)
        // We'll lazily create it once PaneManager.init runs.
        this.canvas = null;

        // Data
        this.dataManager = new DataManager(10000);
        this.viewport = new Viewport();
        this.viewport._dm = this.dataManager;

        // Data feed
        this.dataFeed = new DataFeed(this.dataManager, {
            startPrice: 50000, volatility: 0.012, drift: 0.0001, interval: 60_000
        });

        // Scales
        this.priceScale = new PriceScale();
        this.timeScale = new TimeScale();

        // Series
        this.candleSeries = new CandleSeries();
        // Note: volume is now a pane indicator, so we don't render VolumeSeries on the main pane.

        // Drawing manager
        this.drawingManager = new DrawingManager();
        this.drawingManager._viewport = this.viewport;
        // When a drawing is completed, auto-exit tool mode (back to cursor).
        // User must click the tool button again to draw another.
        this.drawingManager._onToolComplete = () => {
            this.setActiveTool(null);
        };
        this.activeTool = null;

        // Indicator manager (creates PaneManager internally)
        this.indicatorManager = new IndicatorManager(this, this.paneContainer);

        // UI overlays
        this.crosshair = new Crosshair();
        this.tooltip = new Tooltip(this.overlayContainer);
        this.legend = new Legend(this.overlayContainer);
        this.statusBar = new StatusBar(this.statusContainer);
        this.toolbar = new Toolbar(this.toolbarContainer, this);
        this.settingsCard = new DrawingSettingsCard(this.overlayContainer, this);

        // Performance
        this.perf = new Performance();
        this.perf.enabled = true;

        // Render loop
        this.loop = new AnimationLoop(() => this._render());

        // Live mode
        this._liveMode = false;
        this._followInterval = null;
        this._fpsTimer = setInterval(() => this.statusBar.setFps(this.perf.fps), 500);

        // Theme subscription
        this.themeManager.subscribe((theme) => {
            this.theme = theme;
            this.root.classList.toggle('ac-theme-light', theme.name === 'light');
            this.requestRender();
        });
        this.root.classList.toggle('ac-theme-light', this.theme.name === 'light');

        // Initialize panes — main pane gets the canvas
        const mainPane = this.indicatorManager.init(400);
        this.canvas = mainPane.canvas;
        this.mainPane = mainPane;
        this.canvas.onResize = (w, h) => this._onResize(w, h);
        this.eventManager = new EventManager(this.canvas, this);

        // Initial size
        this._onResize(this.canvas.cssWidth, this.canvas.cssHeight);
    }

    init() {
        this.dataFeed.generateHistory(1500);
        // FIX: was fitRange(150, 10) which showed the FIRST 150 bars (oldest).
        // User expects the chart to open on the MOST RECENT candles.
        // Set barSpacing to a sensible default then scroll to the right edge.
        this.viewport.barSpacing = 8;
        this.viewport.rightOffset = 10;
        this.viewport.scrollToRight(this.dataManager.size);
        this.viewport.updatePriceRange(this.dataManager);
        this.statusBar.setBars(this.dataManager.size);
        this.statusBar.setDrawings(0);
        this.legend.update(this.symbol, this.dataManager, this.theme);
        // Add a default volume indicator pane
        this.indicatorManager.add('Volume', {});
        this.requestRender();
    }

    _onResize(w, h) {
        const width = Math.max(100, w);
        const height = Math.max(100, h);
        // Main pane uses its own canvas dimensions. The viewport represents the main pane's coordinate space.
        this.viewport.setSize(width, height, 0); // no volume split on main anymore
        this.viewport.updatePriceRange(this.dataManager);
        this.crosshair._priceScaleWidth = this.priceScale.width;
        this.crosshair._timeScaleHeight = this.timeScale.height;
        this.requestRender();
    }

    requestRender() { this.loop.requestRender(); }

    _render() {
        this.perf.beginRender();
        const ctx = this.canvas.getContext();
        const theme = this.theme;
        const vp = this.viewport;
        const dm = this.dataManager;

        // Update price range from visible data + overlays
        vp.updatePriceRange(dm);
        // Extend range to include overlay indicators (e.g. Bollinger)
        const ovRange = this.indicatorManager.overlayRange(vp, dm);
        if (isFinite(ovRange.min) && isFinite(ovRange.max)) {
            const combined = {
                min: Math.min(vp.priceRange.min, ovRange.min),
                max: Math.max(vp.priceRange.max, ovRange.max)
            };
            vp.priceRange = combined;
        }
        // Update indicator pane ranges
        this.indicatorManager.updatePaneRanges(vp, dm);

        // === MAIN PANE RENDER ===
        // 1. Background
        ctx.fillStyle = theme.chartBg;
        ctx.fillRect(0, 0, vp.width, vp.height);

        // 2. Price grid + Y-axis (draws horizontal gridlines + price labels)
        this.priceScale.draw(ctx, vp, theme);

        // 3. Vertical time gridlines ONLY (no labels — labels go on the bottom time axis strip)
        this.timeScale.drawGridlines(ctx, vp, dm, theme, vp.width, vp.priceHeight);

        // 4. Candles (CLIPPED to chart area, with 5% bottom padding so candles don't touch the time axis)
        ctx.save();
        ctx.beginPath();
        const bottomPadding = vp.priceHeight * 0.05; // 5% gap
        ctx.rect(0, 0, vp.width - this.priceScale.width, vp.priceHeight - bottomPadding);
        ctx.clip();
        this.candleSeries.draw(ctx, vp, dm, theme);

        // 5. Overlay indicators (clipped)
        for (const ind of this.indicatorManager.overlays) {
            ind.draw(ctx, vp, dm, null, theme);
        }

        // 6. Drawings (clipped)
        this.drawingManager.draw(ctx, vp, theme);
        ctx.restore();

        // 7. Crosshair
        this.crosshair.draw(ctx, vp, dm, theme);

        // === INDICATOR PANES RENDER ===
        for (const pane of this.indicatorManager.paneManager.panes) {
            if (pane.isMain) continue;
            this._renderPane(pane, vp, dm, theme);
        }

        // === TIME AXIS STRIP (very bottom) ===
        this._renderTimeAxis(vp, dm, theme);

        // === DOM OVERLAYS ===
        const pointerIdx = this.eventManager.pointerInside
            ? Math.round(this.viewport.xToIndex(this.eventManager.pointerX - this.viewport.barSpacing / 2))
            : -1;
        const clampedIdx = (pointerIdx >= 0 && pointerIdx < dm.size) ? pointerIdx : -1;
        this.tooltip.update(clampedIdx, dm, this.viewport, this.eventManager.pointerInside);
        this.legend.update(this.symbol, dm, theme);
        if (this.eventManager.pointerInside) {
            const price = this.viewport.yToPrice(this.eventManager.pointerY);
            this.statusBar.setCursor(price, pointerIdx);
        }
        this.statusBar.setDrawings(this.drawingManager.count);
        this.statusBar.setBars(dm.size);
        this.statusBar.setIndicators(this.indicatorManager.count);

        this.perf.endRender();
        this.perf.tick();
    }

    /**
     * Render the dedicated time axis strip at the very bottom of the chart.
     * This is the ONLY place time labels appear — panes only draw vertical gridlines.
     * Also draws the crosshair's time label here.
     */
    _renderTimeAxis(vp, dm, theme) {
        const taPane = this.indicatorManager.paneManager.timeAxisPane;
        if (!taPane) return;
        const ctx = taPane.canvas.getContext();
        const w = taPane.canvas.cssWidth;
        const h = taPane.canvas.cssHeight;
        this.timeScale.priceScaleWidth = this.priceScale.width;
        this.timeScale.drawLabels(ctx, vp, dm, theme, w, h);
        // Draw crosshair vertical line on the time axis strip too
        if (this.crosshair.visible) {
            ctx.save();
            ctx.strokeStyle = theme.crosshairColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            const snappedX = this.crosshair.snapToBar ? this.crosshair._snapX(vp) : this.crosshair.x;
            ctx.beginPath();
            ctx.moveTo(snappedX + 0.5, 0);
            ctx.lineTo(snappedX + 0.5, h);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
            // Crosshair time label
            this.crosshair._priceScaleWidth = this.priceScale.width;
            this.crosshair.drawTimeLabel(ctx, vp, dm, theme, w, h);
        }
    }

    _renderPane(pane, vp, dm, theme) {
        if (!pane.visible) return;
        const pctx = pane.canvas.getContext();
        const w = pane.canvas.cssWidth;
        const h = pane.canvas.cssHeight;
        // Background
        pctx.fillStyle = theme.chartBg;
        pctx.fillRect(0, 0, w, h);
        // Grid: horizontal lines at nice ticks of pane.priceRange
        const { min, max } = pane.priceRange;
        const ticks = this._niceTicks(min, max, 4);
        pctx.strokeStyle = theme.gridLine;
        pctx.lineWidth = 1;
        pctx.setLineDash([2, 3]);
        pctx.font = "10px 'JetBrains Mono', monospace";
        pctx.fillStyle = theme.priceScaleText;
        pctx.textAlign = 'left';
        pctx.textBaseline = 'middle';
        for (const t of ticks) {
            const y = this._panePriceToY(t, pane, h);
            pctx.beginPath();
            pctx.moveTo(0, y + 0.5);
            pctx.lineTo(w - this.priceScale.width, y + 0.5);
            pctx.stroke();
            pctx.fillText(this._fmt(t), w - this.priceScale.width + 4, y);
        }
        pctx.setLineDash([]);
        // Vertical gridlines (aligned with time scale)
        const barSpacing = vp.barSpacing;
        const step = Math.max(1, Math.ceil(this.timeScale.minTickSpacing / barSpacing));
        const leftIdx = Math.floor(vp.leftEdge);
        const startIdx = Math.ceil(leftIdx / step) * step;
        const rightIdx = Math.ceil(vp.rightEdge);
        pctx.strokeStyle = theme.gridLine;
        pctx.setLineDash([2, 3]);
        for (let i = startIdx; i <= rightIdx; i += step) {
            if (i < 0 || i >= dm.size) continue;
            const x = vp.indexToX(i) + barSpacing / 2;
            pctx.beginPath();
            pctx.moveTo(x + 0.5, 0);
            pctx.lineTo(x + 0.5, h);
            pctx.stroke();
        }
        pctx.setLineDash([]);
        // Right border
        pctx.strokeStyle = theme.priceScaleBorder;
        pctx.beginPath();
        pctx.moveTo(w - this.priceScale.width + 0.5, 0);
        pctx.lineTo(w - this.priceScale.width + 0.5, h);
        pctx.stroke();
        // Top border
        pctx.strokeStyle = theme.paneDivider;
        pctx.beginPath();
        pctx.moveTo(0, 0.5);
        pctx.lineTo(w, 0.5);
        pctx.stroke();
        // Clip to chart area for indicator drawing
        pctx.save();
        pctx.beginPath();
        pctx.rect(0, 0, w - this.priceScale.width, h);
        pctx.clip();
        // Set pane's innerHeight for the indicator's _priceToY
        pane.innerHeight = h;
        pane.width = w;
        for (const ind of pane.indicators) {
            if (!ind.visible) continue;
            ind.draw(pctx, vp, dm, pane, theme);
        }
        pctx.restore();
        // Pane title
        pctx.font = "bold 10px 'Inter', sans-serif";
        pctx.fillStyle = theme.mutedText;
        pctx.textAlign = 'left';
        pctx.textBaseline = 'top';
        pctx.fillText(pane.title, 8, 4);
    }

    _panePriceToY(value, pane, h) {
        const range = pane.priceRange;
        if (range.min === range.max) return h / 2;
        const t = (value - range.min) / (range.max - range.min);
        return (1 - t) * h;
    }
    _niceTicks(min, max, count) {
        if (min === max) { min -= 1; max += 1; }
        const range = max - min;
        const step = Math.pow(10, Math.floor(Math.log10(range / count)));
        const err = (count / range) * step;
        let niceStep;
        if (err <= 0.15) niceStep = step * 10;
        else if (err <= 0.35) niceStep = step * 5;
        else if (err <= 0.75) niceStep = step * 2;
        else niceStep = step;
        const ticks = [];
        const start = Math.ceil(min / niceStep) * niceStep;
        for (let v = start; v <= max + niceStep * 0.5; v += niceStep) ticks.push(v);
        return ticks;
    }
    _fmt(v) {
        const abs = Math.abs(v);
        if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (abs >= 1e3) return (v / 1e3).toFixed(2) + 'K';
        if (abs >= 1) return v.toFixed(2);
        return v.toFixed(4);
    }

    // ---- Public API ----
    setActiveTool(tool) {
        this.activeTool = tool;
        this.drawingManager.setActiveTool(tool);
        this.toolbar.setActiveTool(tool);
        // Hide settings card when entering draw mode
        if (tool) this.settingsCard.hide();
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

    toggleTheme() { this.themeManager.toggle(); }

    toggleLive() {
        const btn = document.getElementById('ac-live-btn');
        if (this._liveMode) {
            this.dataFeed.stop();
            this._liveMode = false;
            if (this._followInterval) clearInterval(this._followInterval);
            btn?.classList.remove('active');
        } else {
            this.dataFeed.start(1500);
            this._liveMode = true;
            btn?.classList.add('active');
            this._followInterval = setInterval(() => {
                if (this.dataManager.size > 0) {
                    const rightEdge = this.viewport.rightEdge;
                    const lastIdx = this.dataManager.size - 1;
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

    addIndicator(key, options = {}) {
        const ind = this.indicatorManager.add(key, options);
        this.requestRender();
        return ind;
    }

    removeIndicator(id) {
        this.indicatorManager.remove(id);
        this.requestRender();
    }

    destroy() {
        clearInterval(this._fpsTimer);
        clearInterval(this._followInterval);
        this.dataFeed.stop();
        this.loop.stop();
        this.eventManager.destroy();
        this.indicatorManager.paneManager.destroy();
        this.root.remove();
    }
}
