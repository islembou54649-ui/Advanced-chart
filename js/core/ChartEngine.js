/**
 * ChartEngine.js
 * The main orchestrator. Owns all subsystems and runs the render loop.
 *
 * v0.4 Architecture: ONE canvas for everything.
 * - All panes (main + indicators + time axis) are regions on the SAME canvas.
 * - Crosshair vertical line extends across ALL regions (connected, not broken).
 * - Current-price line extends across ALL regions.
 * - Divider lines between regions are drawn on the same canvas.
 * - No floating tooltip — cursor candle OHLCV info is drawn as a FIXED bar at the
 *   top-left, just below the top info strip (at y=28). // FIX: moved from bottom-left.
 * - No legend card — info is drawn as a horizontal strip at the top.
 *
 * Render order per frame:
 *   1. Background fill (entire canvas)
 *   2. For each region (main + indicators): gridlines + content (clipped)
 *   3. Divider lines between regions
 *   4. Current-price line (extends across ALL regions, unclipped)
 *   5. Time axis labels (bottom strip) — drawn BEFORE crosshair
 *   6. Crosshair (extends across ALL regions + time label on time axis, unclipped)
 *      // FIX: Time axis is now rendered BEFORE the crosshair so the crosshair's
 *      // time label box appears ON TOP of the time axis background (was previously
 *      // drawn underneath and hidden).
 *   7. Top info strip (symbol + price + OHLCV as horizontal text)
 *   8. Cursor info bar (cursor candle OHLCV, FIXED at top-left just below the top
 *      strip at y=28 — was previously at the bottom of the chart)
 *   9. DOM overlays (settings card only)
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
import { ChartTypeManager, CHART_TYPES } from '../series/ChartTypeManager.js';
import { Crosshair } from '../ui/Crosshair.js';
import { StatusBar } from '../ui/StatusBar.js';
import { Toolbar } from '../ui/Toolbar.js';
import { ThemeManager } from '../ui/Theme.js';
import { DrawingManager } from '../drawing/DrawingManager.js';
import { DrawingSettingsCard } from '../ui/DrawingSettingsCard.js';
import { IndicatorManager } from '../indicators/IndicatorManager.js';
import { Performance } from '../utils/Performance.js';
import { DomUtils } from '../utils/DomUtils.js';
import { MathUtils } from '../utils/MathUtils.js';

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

        // Canvas (set by PaneManager.init — it creates the shared canvas)
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
        this.chartTypeManager = new ChartTypeManager();

        // Drawing manager
        this.drawingManager = new DrawingManager();
        this.drawingManager._viewport = this.viewport;
        this.drawingManager._onToolComplete = () => { this.setActiveTool(null); };
        this.activeTool = null;

        // Indicator manager (creates PaneManager internally)
        this.indicatorManager = new IndicatorManager(this, this.paneContainer);

        // UI overlays — NO Tooltip, NO Legend (replaced with canvas-drawn info strips)
        this.crosshair = new Crosshair();
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

        // Initialize panes — this creates the shared canvas
        const mainPane = this.indicatorManager.init(400);
        this.canvas = this.indicatorManager.paneManager.canvas;
        this.mainPane = mainPane;
        this.canvas.onResize = (w, h) => this._onResize(w, h);
        this.eventManager = new EventManager(this.canvas, this);

        // Initial size
        this._onResize(this.canvas.cssWidth, this.canvas.cssHeight);
    }

    init() {
        this.dataFeed.generateHistory(1500);
        this.viewport.barSpacing = 8;
        this.viewport.rightOffset = 10;
        this.viewport.scrollToRight(this.dataManager.size);
        this.viewport.updatePriceRange(this.dataManager);
        this.statusBar.setBars(this.dataManager.size);
        this.statusBar.setDrawings(0);
        // Add a default volume indicator pane
        this.indicatorManager.add('Volume', {});
        this.requestRender();
    }

    _onResize(w, h) {
        const width = Math.max(100, w);
        const height = Math.max(100, h);
        // The viewport's width/height represents the entire canvas (all regions).
        // The main region's height is computed from PaneManager.getRegions() at render time.
        this.viewport.setSize(width, height, 0);
        this.viewport.updatePriceRange(this.dataManager);
        this.crosshair._priceScaleWidth = this.priceScale.width;
        this.crosshair._timeScaleHeight = this.timeScale.height;
        this.requestRender();
    }

    requestRender() { this.loop.requestRender(); }

    /**
     * Get the main price region's rect (the area where candles render).
     */
    _getMainRegion() {
        const regions = this.indicatorManager.paneManager.getRegions();
        return regions.find(r => r.id === 'main');
    }

    _render() {
        this.perf.beginRender();
        const ctx = this.canvas.getContext();
        const theme = this.theme;
        const dm = this.dataManager;
        const canvasW = this.canvas.cssWidth;
        const canvasH = this.canvas.cssHeight;
        const priceScaleW = this.priceScale.width;

        // Compute regions
        const regions = this.indicatorManager.paneManager.getRegions();
        const mainRegion = regions.find(r => r.id === 'main');
        const timeAxisRegion = regions.find(r => r.id === 'timeaxis');
        const indicatorRegions = regions.filter(r => r.id !== 'main' && r.id !== 'timeaxis');

        // Set the viewport's priceHeight to the main region's height (for candle autoscale)
        if (mainRegion) {
            this.viewport.priceHeight = mainRegion.rect.h;
        }

        // Update price range from visible data + overlays
        this.viewport.updatePriceRange(dm);
        const ovRange = this.indicatorManager.overlayRange(this.viewport, dm);
        if (isFinite(ovRange.min) && isFinite(ovRange.max)) {
            this.viewport.priceRange = {
                min: Math.min(this.viewport.priceRange.min, ovRange.min),
                max: Math.max(this.viewport.priceRange.max, ovRange.max)
            };
        }
        // Update indicator pane ranges
        this.indicatorManager.updatePaneRanges(this.viewport, dm);

        // === 1. Background fill (entire canvas) ===
        ctx.fillStyle = theme.chartBg;
        ctx.fillRect(0, 0, canvasW, canvasH);

        // === 2. Render each region ===
        // Main region: candles + overlays + drawings
        if (mainRegion) {
            this._renderMainRegion(ctx, mainRegion, theme, priceScaleW);
        }
        // Indicator regions
        for (const r of indicatorRegions) {
            this._renderIndicatorRegion(ctx, r, theme, priceScaleW);
        }

        // === 3. Divider lines between regions (connected, on same canvas) ===
        ctx.strokeStyle = theme.paneDivider;
        ctx.lineWidth = 1;
        for (let i = 0; i < regions.length - 1; i++) {
            const r = regions[i];
            const y = r.rect.y + r.rect.h;
            // The divider is at the bottom of each region (where the resize handle is)
            // Draw it as a solid line spanning the full width INCLUDING the price scale
            ctx.beginPath();
            ctx.moveTo(0, y + 0.5);
            ctx.lineTo(canvasW, y + 0.5);
            ctx.stroke();
        }

        // === 4. Current-price line (extends across ALL regions, unclipped) ===
        this._drawCurrentPriceLine(ctx, regions, theme, priceScaleW);

        // === 5. Time axis labels (bottom strip) — drawn BEFORE crosshair so the
        //        crosshair's time label appears ON TOP of the time axis background ===
        if (timeAxisRegion) {
            this._renderTimeAxisRegion(ctx, timeAxisRegion, dm, theme, priceScaleW);
        }

        // === 6. Crosshair (extends across ALL regions, unclipped) — drawn AFTER
        //        time axis so its time label is visible on top ===
        this._drawCrosshair(ctx, regions, dm, theme, priceScaleW, canvasW, canvasH);

        // === 7. Top info strip (horizontal text: symbol + price + OHLCV) ===
        this._drawTopInfoStrip(ctx, dm, theme, canvasW);

        // === 8. Bottom info bar (cursor candle OHLCV, fixed in bottom-left) ===
        this._drawBottomInfoBar(ctx, regions, dm, theme, priceScaleW);

        // === Status bar updates ===
        if (this.eventManager.pointerInside) {
            const idx = Math.round(this.viewport.xToIndex(this.eventManager.pointerX - this.viewport.barSpacing / 2));
            const price = this.viewport.yToPrice(this.eventManager.pointerY);
            this.statusBar.setCursor(price, idx);
        }
        this.statusBar.setDrawings(this.drawingManager.count);
        this.statusBar.setBars(dm.size);
        this.statusBar.setIndicators(this.indicatorManager.count);

        this.perf.endRender();
        this.perf.tick();
    }

    /**
     * Render the main price region: candles, overlay indicators, drawings, price grid.
     */
    _renderMainRegion(ctx, region, theme, priceScaleW) {
        const vp = this.viewport;
        const dm = this.dataManager;
        const { x, y, w, h } = region.rect;
        const chartW = w - priceScaleW; // chart area excludes the price scale

        // Set viewport's priceHeight for priceToY calculations
        vp.priceHeight = h;

        // Clip to this region
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();

        // Translate so (0,0) is the top-left of this region
        ctx.translate(0, y);

        // Price grid + Y-axis labels (draws horizontal gridlines + price labels on the right)
        this.priceScale.draw(ctx, vp, theme);

        // Vertical time gridlines (no labels — labels go on the time axis strip)
        this.timeScale.drawGridlines(ctx, vp, dm, theme, w, h);

        // Candles (CLIPPED to chart area, with 5% bottom padding)
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, chartW, h - h * 0.05);
        ctx.clip();
        // FIX: use ChartTypeManager to render the current chart type (candles, hollow, heikin-ashi, etc.)
        this.chartTypeManager.draw(ctx, vp, dm, theme);

        // Overlay indicators
        for (const ind of this.indicatorManager.overlays) {
            ind.draw(ctx, vp, dm, null, theme);
        }

        // Drawings
        this.drawingManager.draw(ctx, vp, theme);
        ctx.restore();

        // FIX: draw the pane title bar with overlay control buttons.
        // Previously the main pane had no title bar, so overlay indicators
        // (SMA, EMA, BollingerBands, etc.) had no visible control buttons.
        // Now we draw the same title+buttons row that indicator panes use,
        // so overlays get ⇅ / ◉ / ⚙ / ✕ controls in the top-left of the chart.
        this._drawPaneTitleWithControls(ctx, this.mainPane, theme);

        ctx.restore();
    }

    /**
     * Render an indicator region (RSI, MACD, etc.).
     */
    _renderIndicatorRegion(ctx, region, theme, priceScaleW) {
        const vp = this.viewport;
        const dm = this.dataManager;
        const pane = region.pane;
        const { x, y, w, h } = region.rect;
        const chartW = w - priceScaleW;
        if (h < 10) return;

        // Clip to this region
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.translate(0, y);

        // Horizontal gridlines at nice ticks of pane.priceRange
        const { min, max } = pane.priceRange;
        const ticks = this._niceTicks(min, max, 4);
        ctx.strokeStyle = theme.gridLine;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.font = "10px 'JetBrains Mono', monospace";
        ctx.fillStyle = theme.priceScaleText;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (const t of ticks) {
            const ty = this._regionPriceToY(t, pane, h);
            ctx.beginPath();
            ctx.moveTo(0, ty + 0.5);
            ctx.lineTo(chartW, ty + 0.5);
            ctx.stroke();
            ctx.fillText(this._fmt(t), chartW + 4, ty);
        }
        ctx.setLineDash([]);

        // Vertical time gridlines (aligned with main chart)
        this.timeScale.drawGridlines(ctx, vp, dm, theme, w, h);

        // Right border (between chart area and price scale)
        ctx.strokeStyle = theme.priceScaleBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(chartW + 0.5, 0);
        ctx.lineTo(chartW + 0.5, h);
        ctx.stroke();

        // Draw the indicator's content (clipped to chart area)
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, chartW, h);
        ctx.clip();
        pane.innerHeight = h;
        pane.width = w;
        for (const ind of pane.indicators) {
            if (!ind.visible) continue;
            ind.draw(ctx, vp, dm, pane, theme);
        }
        ctx.restore();

        // Pane title (top-left) with indicator controls: [name] [⇅ reverse] [👁 show/hide] [⚙ settings] [✕ remove]
        this._drawPaneTitleWithControls(ctx, pane, theme);

        ctx.restore();
    }

    /**
     * Draw the pane title bar with indicator control buttons.
     * Buttons are drawn on canvas at fixed positions; hit-testing is done
     * in _handlePaneButtonClick (called from EventManager).
     */
    _drawPaneTitleWithControls(ctx, pane, theme) {
        const buttons = this._getPaneButtons(pane);
        // Title text
        ctx.font = "bold 11px 'Inter', sans-serif";
        ctx.fillStyle = theme.textColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(pane.title, 8, 4);
        let x = 8 + ctx.measureText(pane.title).width + 12;
        // Buttons
        for (const btn of buttons) {
            btn.x = x;
            btn.y = 3;
            btn.w = 18;
            btn.h = 16;
            // Button background on hover/active
            if (btn.hovered) {
                ctx.fillStyle = theme.toolbarBtn;
                ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
            }
            // Icon
            ctx.font = "12px 'Inter', sans-serif";
            ctx.fillStyle = btn.active ? theme.upColor : theme.mutedText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(btn.icon, btn.x + btn.w / 2, btn.y + btn.h / 2 + 1);
            x += btn.w + 4;
        }
        // Store buttons for hit-testing
        pane._buttons = buttons;
    }

    /**
     * Get the control buttons for a pane.
     *
     * FIX: the main pane's `pane.indicators` array is empty (overlays live
     * at IndicatorManager.indicators level, not in pane.indicators). So for
     * the main pane we look at the overlay indicators; for indicator panes
     * we use pane.indicators as before. Without this, overlay indicators
     * like SMA/EMA/BollingerBands had no visible control buttons.
     */
    _getPaneButtons(pane) {
        const buttons = [];
        const indicators = pane.isMain
            ? this.indicatorManager.indicators.filter(i => i.type === 'overlay')
            : pane.indicators;
        for (const ind of indicators) {
            // Reverse button (only for indicators that support reversal)
            buttons.push({
                id: 'reverse', indicatorId: ind.id, icon: '⇅',
                title: 'Reverse', hovered: false, active: !!ind.reversed
            });
            // Show/hide toggle
            buttons.push({
                id: 'toggle', indicatorId: ind.id, icon: ind.visible ? '◉' : '◯',
                title: ind.visible ? 'Hide' : 'Show', hovered: false, active: ind.visible
            });
            // Settings
            buttons.push({
                id: 'settings', indicatorId: ind.id, icon: '⚙',
                title: 'Settings', hovered: false, active: false
            });
            // Remove
            buttons.push({
                id: 'remove', indicatorId: ind.id, icon: '✕',
                title: 'Remove', hovered: false, active: false
            });
        }
        return buttons;
    }

    /**
     * Handle a click on a pane button. Called from EventManager.
     * Returns true if a button was hit.
     *
     * FIX: pane._buttons stores button positions in PANE-LOCAL coordinates
     * (btn.y = 3 means "3px from the top of this pane"). But the (x, y) we
     * receive here are CANVAS-GLOBAL coordinates (from EventManager's
     * _getPos, which is `e.clientY - rect.top`). So for an indicator pane
     * that starts at canvas y=365 (e.g. the Volume pane), the button is
     * visually at canvas y=368 but stored as btn.y=3. A click at canvas
     * y=368 would fail the old `y >= btn.y` test (368 >= 3 is true, but
     * 368 <= 19 is false).
     *
     * Fix: look up each pane's region and add region.rect.y to btn.y
     * before hit-testing. We also restrict the hit-test to clicks that
     * fall inside the pane's region, so a click in the main pane can't
     * accidentally match a button in the RSI pane (whose btn.y=3 would
     * otherwise overlap the main pane's top).
     */
    handlePaneButtonClick(x, y) {
        const regions = this.indicatorManager.paneManager.getRegions();
        // Map each pane object to its region rect for quick lookup.
        const regionByPane = new Map();
        for (const r of regions) regionByPane.set(r.pane, r.rect);

        for (const pane of this.indicatorManager.paneManager.panes) {
            if (!pane._buttons || pane._buttons.length === 0) continue;
            const rect = regionByPane.get(pane);
            if (!rect) continue;
            // Ignore clicks that aren't even inside this pane's region.
            if (y < rect.y || y >= rect.y + rect.h) continue;
            // FIX: convert pane-local btn.y to canvas-global by adding rect.y.
            const paneY = rect.y;
            for (const btn of pane._buttons) {
                const btnY = paneY + btn.y;
                if (x >= btn.x && x <= btn.x + btn.w && y >= btnY && y <= btnY + btn.h) {
                    const ind = this.indicatorManager.indicators.find(i => i.id === btn.indicatorId);
                    if (!ind) return true;
                    if (btn.id === 'reverse') {
                        ind.reversed = !ind.reversed;
                    } else if (btn.id === 'toggle') {
                        ind.visible = !ind.visible;
                    } else if (btn.id === 'settings') {
                        // Cycle through common periods
                        const periods = [7, 14, 20, 21, 50, 100, 200];
                        const cur = ind.options.period || 14;
                        const idx = periods.indexOf(cur);
                        const next = periods[(idx + 1) % periods.length];
                        ind.options.period = next;
                        ind._lastDataVersion = -1; // force recalc
                    } else if (btn.id === 'remove') {
                        this.indicatorManager.remove(ind.id);
                    }
                    this.requestRender();
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Render the time axis strip at the very bottom.
     */
    _renderTimeAxisRegion(ctx, region, dm, theme, priceScaleW) {
        const vp = this.viewport;
        const { x, y, w, h } = region.rect;
        ctx.save();
        ctx.translate(0, y);
        this.timeScale.priceScaleWidth = priceScaleW;
        this.timeScale.drawLabels(ctx, vp, dm, theme, w, h);
        ctx.restore();
    }

    /**
     * Draw the current-price line across ALL regions (connected, not broken).
     * This is the horizontal dashed line at the last close price, with a price tag on the right.
     */
    _drawCurrentPriceLine(ctx, regions, theme, priceScaleW) {
        const dm = this.dataManager;
        if (dm.size === 0) return;
        const last = dm.get(dm.size - 1);
        if (!last) return;
        const vp = this.viewport;
        const mainRegion = regions.find(r => r.id === 'main');
        if (!mainRegion) return;
        // The price Y is relative to the main region's top
        const yInMain = vp.priceToY(last.close);
        const absY = mainRegion.rect.y + yInMain;
        const canvasW = this.canvas.cssWidth;
        const isUp = last.close >= last.open;
        const color = isUp ? theme.upColor : theme.downColor;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        // FIX: Compute bottomY = bottom of the last indicator region (just above time axis).
        // The variable was previously computed but never used, which meant the price line
        // only appeared as a single horizontal line inside the main region and did not
        // extend through the volume / RSI panes (Test 5 failure).
        let bottomY = mainRegion.rect.y + mainRegion.rect.h;
        for (const r of regions) {
            if (r.id === 'timeaxis') continue;
            if (r.id === 'main') continue;
            bottomY = r.rect.y + r.rect.h;
        }
        // Horizontal dashed line at the close-price Y (inside main region)
        ctx.moveTo(0, absY + 0.5);
        ctx.lineTo(canvasW - priceScaleW, absY + 0.5);
        ctx.stroke();
        // FIX: Vertical dashed line on the right edge of the chart area, extending from
        // the close-price Y (absY) down to the bottom of the last indicator pane.
        // This makes the current-price line visibly CROSS ALL PANES — the dashed line
        // is now visible inside the volume and RSI panes as well, satisfying the
        // "extends across ALL regions (connected, not broken)" requirement.
        if (bottomY > absY) {
            ctx.beginPath();
            ctx.moveTo(canvasW - priceScaleW + 0.5, absY + 0.5);
            ctx.lineTo(canvasW - priceScaleW + 0.5, bottomY + 0.5);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Price tag on the right (in the price scale area, at the main region's Y)
        const tagX = canvasW - priceScaleW;
        const label = MathUtils.formatPrice(last.close);
        ctx.font = "bold 11px 'JetBrains Mono', monospace";
        const m = ctx.measureText(label);
        const tagW = m.width + 12;
        const tagH = 18;
        ctx.fillStyle = color;
        ctx.fillRect(tagX, absY - tagH / 2, tagW, tagH);
        ctx.fillStyle = theme.lastPriceTagText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, tagX + tagW / 2, absY);
        ctx.restore();
    }

    /**
     * Draw the crosshair across ALL regions (vertical line + horizontal line + labels).
     */
    _drawCrosshair(ctx, regions, dm, theme, priceScaleW, canvasW, canvasH) {
        if (!this.crosshair.visible) return;
        const vp = this.viewport;
        const mainRegion = regions.find(r => r.id === 'main');
        if (!mainRegion) return;
        // FIX: Don't draw the vertical crosshair line when the cursor is on the
        // price axis. The snapped index is meaningless there and the line would
        // overlap the price labels. Only the horizontal line + price label should
        // appear when the cursor is on the price axis.
        const inPriceAxis = this.crosshair.x >= canvasW - priceScaleW;
        const snappedX = this.crosshair.snapToBar ? this.crosshair._snapX(vp) : this.crosshair.x;
        // Vertical line: extends from top of main region to bottom of last indicator region
        let bottomY = mainRegion.rect.y + mainRegion.rect.h;
        for (const r of regions) {
            if (r.id === 'timeaxis' || r.id === 'main') continue;
            bottomY = r.rect.y + r.rect.h;
        }
        ctx.save();
        ctx.strokeStyle = theme.crosshairColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        // Vertical line — ONLY when cursor is in the chart area (not on price axis)
        if (!inPriceAxis) {
            ctx.beginPath();
            ctx.moveTo(snappedX + 0.5, mainRegion.rect.y);
            ctx.lineTo(snappedX + 0.5, bottomY);
            ctx.stroke();
        }
        // Horizontal line (only inside main region, at cursor Y relative to main)
        const cursorYInMain = this.crosshair.y - mainRegion.rect.y;
        if (cursorYInMain >= 0 && cursorYInMain < mainRegion.rect.h) {
            ctx.beginPath();
            ctx.moveTo(0, this.crosshair.y + 0.5);
            ctx.lineTo(canvasW - priceScaleW, this.crosshair.y + 0.5);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Price label on the right axis (only if cursor is in main region)
        if (cursorYInMain >= 0 && cursorYInMain < mainRegion.rect.h) {
            const price = vp.yToPrice(cursorYInMain);
            const label = MathUtils.formatPrice(price);
            ctx.font = "bold 11px 'JetBrains Mono', monospace";
            const m = ctx.measureText(label);
            const tagW = m.width + 14;
            const tagH = 18;
            const tx = canvasW - priceScaleW;
            const ty = this.crosshair.y - tagH / 2;
            ctx.fillStyle = theme.crosshairLabelBg;
            ctx.fillRect(tx, ty, tagW, tagH);
            ctx.fillStyle = theme.crosshairLabelText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, tx + tagW / 2, ty + tagH / 2);
        }

        // Time label on the time axis strip — skip when cursor is on the price axis
        // (the snapped index is meaningless there)
        const timeAxisRegion = regions.find(r => r.id === 'timeaxis');
        if (timeAxisRegion && !inPriceAxis) {
            // FIX: Previously this used `Math.round(vp.xToIndex(snappedX))` where
            // `snappedX` is the snapped bar's CENTER (fractional index = barIdx + 0.5).
            // `Math.round(barIdx + 0.5)` returned `barIdx + 1`, causing the time label
            // to display the NEXT minute instead of the CURRENT minute the cursor is
            // actually hovering over. We now read the bar index directly from the
            // cursor's X via `Math.floor()`, which is consistent with Crosshair.js.
            const idx = this.crosshair._getSnappedIdx(vp);
            if (idx >= 0 && idx < dm.size) {
                const time = dm.times[idx];
                const d = new Date(time);
                const label = this._formatTime(d, dm.interval);
                ctx.font = "bold 11px 'JetBrains Mono', monospace";
                const m = ctx.measureText(label);
                const tagW = m.width + 14;
                const tagH = 18;
                const tx = Math.max(0, Math.min(canvasW - priceScaleW - tagW, snappedX - tagW / 2));
                const ty = timeAxisRegion.rect.y + (timeAxisRegion.rect.h - tagH) / 2;
                ctx.fillStyle = theme.crosshairLabelBg;
                ctx.fillRect(tx, ty, tagW, tagH);
                ctx.fillStyle = theme.crosshairLabelText;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, tx + tagW / 2, ty + tagH / 2);
            }
        }
        ctx.restore();
    }

    /**
     * Draw the top info strip: a single horizontal line of text showing
     * symbol + current price + change + OHLCV of the last candle.
     * This replaces the old floating legend card.
     */
    _drawTopInfoStrip(ctx, dm, theme, canvasW) {
        if (dm.size === 0) return;
        const last = dm.get(dm.size - 1);
        if (!last) return;
        const prev = dm.size > 1 ? dm.get(dm.size - 2) : last;
        const change = last.close - prev.close;
        const changePct = prev.close ? (change / prev.close) * 100 : 0;
        const isUp = change >= 0;
        const color = isUp ? theme.upColor : theme.downColor;
        const arrow = isUp ? '▲' : '▼';

        ctx.save();
        ctx.font = "12px 'Inter', sans-serif";
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';

        let x = 12;
        const y = 8;
        // Symbol
        ctx.fillStyle = theme.textColor;
        ctx.font = "bold 13px 'Inter', sans-serif";
        ctx.fillText(this.symbol, x, y);
        x += ctx.measureText(this.symbol).width + 16;

        // Price
        ctx.fillStyle = color;
        ctx.font = "bold 13px 'JetBrains Mono', monospace";
        ctx.fillText(MathUtils.formatPrice(last.close), x, y);
        x += ctx.measureText(MathUtils.formatPrice(last.close)).width + 12;

        // Change
        ctx.font = "12px 'JetBrains Mono', monospace";
        const changeTxt = `${arrow} ${change >= 0 ? '+' : ''}${change.toFixed(4)} (${changePct.toFixed(2)}%)`;
        ctx.fillText(changeTxt, x, y);
        x += ctx.measureText(changeTxt).width + 20;

        // OHLCV
        ctx.fillStyle = theme.mutedText;
        ctx.font = "11px 'JetBrains Mono', monospace";
        const ohlcv = `O ${MathUtils.formatPrice(last.open)}  H ${MathUtils.formatPrice(last.high)}  L ${MathUtils.formatPrice(last.low)}  C ${MathUtils.formatPrice(last.close)}  Vol ${this._fmtVol(last.volume)}`;
        ctx.fillText(ohlcv, x, y);
        ctx.restore();
    }

    /**
     * Draw the cursor-candle info bar: FIXED in the top-left corner, just below
     * the top info strip. Shows the OHLCV of the candle under the cursor.
     * This replaces the floating tooltip that used to follow the mouse.
     *
     * User requested: "put it under the top strip in the left corner" — so it's
     * a fixed horizontal line of text at y=28 (right below the top strip at y=8).
     */
    _drawBottomInfoBar(ctx, regions, dm, theme, priceScaleW) {
        if (!this.eventManager.pointerInside) return;
        const vp = this.viewport;
        const idx = Math.round(vp.xToIndex(this.eventManager.pointerX - vp.barSpacing / 2));
        if (idx < 0 || idx >= dm.size) return;
        const c = dm.get(idx);
        if (!c) return;

        // FIXED position: top-left, just below the top info strip (y=8, height ~16, so y=28)
        const barY = 28;
        const change = c.close - c.open;
        const changePct = c.open ? (change / c.open) * 100 : 0;
        const isUp = change >= 0;
        const color = isUp ? theme.upColor : theme.downColor;
        const d = new Date(c.time);
        const timeStr = d.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

        ctx.save();
        ctx.font = "11px 'JetBrains Mono', monospace";
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        let x = 12;
        // Time
        ctx.fillStyle = theme.mutedText;
        ctx.fillText(timeStr, x, barY);
        x += ctx.measureText(timeStr).width + 16;
        // O H L C
        const parts = [
            { label: 'O', value: MathUtils.formatPrice(c.open) },
            { label: 'H', value: MathUtils.formatPrice(c.high) },
            { label: 'L', value: MathUtils.formatPrice(c.low) },
            { label: 'C', value: MathUtils.formatPrice(c.close) }
        ];
        for (const p of parts) {
            ctx.fillStyle = theme.mutedText;
            ctx.fillText(p.label, x, barY);
            x += ctx.measureText(p.label).width + 4;
            ctx.fillStyle = color;
            ctx.fillText(p.value, x, barY);
            x += ctx.measureText(p.value).width + 12;
        }
        // Change
        const changeTxt = `${change >= 0 ? '+' : ''}${change.toFixed(4)} (${changePct.toFixed(2)}%)`;
        ctx.fillStyle = color;
        ctx.fillText(changeTxt, x, barY);
        x += ctx.measureText(changeTxt).width + 12;
        // Volume
        ctx.fillStyle = theme.mutedText;
        ctx.fillText('Vol ' + this._fmtVol(c.volume), x, barY);
        ctx.restore();
    }

    // ---- Helpers ----
    _regionPriceToY(value, pane, h) {
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
    _fmtVol(v) {
        if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
        return v.toFixed(0);
    }
    _formatTime(d, interval) {
        const pad = (n) => String(n).padStart(2, '0');
        const pad3 = (n) => String(n).padStart(3, '0');
        const hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes());
        if (interval < 1000) {
            // sub-second: HH:MM:SS.mmm
            return hhmm + ':' + pad(d.getSeconds()) + '.' + pad3(d.getMilliseconds());
        } else if (interval < 60 * 1000) {
            // sub-minute: HH:MM:SS
            return hhmm + ':' + pad(d.getSeconds());
        } else if (interval < 24 * 60 * 60 * 1000) {
            // intraday (>= 1 minute): HH:MM
            return hhmm;
        } else {
            return d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getFullYear();
        }
    }

    // ---- Public API ----
    setChartType(type) {
        this.chartTypeManager.set(type);
        this.requestRender();
    }
    getChartType() { return this.chartTypeManager.get(); }

    setActiveTool(tool) {
        this.activeTool = tool;
        this.drawingManager.setActiveTool(tool);
        this.toolbar.setActiveTool(tool);
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
        this.viewport.scrollToRight(this.dataManager.size);
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
