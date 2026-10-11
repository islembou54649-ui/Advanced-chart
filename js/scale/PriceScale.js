/**
 * PriceScale.js
 * Renders the price (Y) axis on the right side of the chart.
 * v0.5 improvements:
 * - Solid gridlines (not dashed) for a cleaner look like TradingView
 * - Better tick spacing with more padding
 * - Cleaner price label formatting
 * - Price tag with rounded corners
 * - Wider axis for better readability
 */
import { MathUtils } from '../utils/MathUtils.js';

export class PriceScale {
    constructor(options = {}) {
        this.width = options.width || 72;
        this.fontSize = options.fontSize || 11;
        this.fontFamily = options.fontFamily || "'JetBrains Mono', 'Consolas', monospace";
        this.tickCount = options.tickCount || 7;
        this.align = options.align || 'right';
    }

    /**
     * Draw the price axis labels.
     */
    draw(ctx, viewport, theme) {
        const x = viewport.width - this.width;
        const y = 0;
        const w = this.width;
        const h = viewport.priceHeight;

        // Background
        ctx.fillStyle = theme.priceScaleBg;
        ctx.fillRect(x, y, w, h);

        // Border line (left edge of price scale)
        ctx.strokeStyle = theme.priceScaleBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();

        // Compute nice ticks for the visible price range
        const { min, max } = viewport.priceRange;
        const { ticks } = MathUtils.niceTicks(min, max, this.tickCount);

        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.priceScaleText;

        for (const price of ticks) {
            if (price < min || price > max) continue;
            const py = viewport.priceToY(price);
            // Gridline on chart — SOLID, very subtle (like TradingView)
            ctx.strokeStyle = theme.gridLine;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, py + 0.5);
            ctx.lineTo(x, py + 0.5);
            ctx.stroke();
            // Label
            const label = MathUtils.formatPrice(price);
            ctx.textAlign = 'right';
            ctx.fillStyle = theme.priceScaleText;
            ctx.fillText(label, x + w - 8, py);
        }

        // Last price line + label
        this._drawLastPriceLine(ctx, viewport, theme);
    }

    /**
     * Draw the horizontal line indicating the most recent close, plus a price tag.
     * The line is SOLID (not dashed) and extends across the chart.
     * The price tag has a pointed left edge (like TradingView).
     */
    _drawLastPriceLine(ctx, viewport, theme) {
        const dm = viewport._dm;
        if (!dm || dm.size === 0) return;
        const last = dm.get(dm.size - 1);
        if (!last) return;
        const y = viewport.priceToY(last.close);
        if (y < 0 || y > viewport.priceHeight) return;

        const isUp = last.close >= last.open;
        const color = isUp ? theme.upColor : theme.downColor;
        const chartW = viewport.width - this.width;

        // Solid line across chart (thin)
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(chartW, y + 0.5);
        ctx.stroke();

        // Price tag on the scale — pointed left, fills the price scale width
        const x = viewport.width - this.width;
        const label = MathUtils.formatPrice(last.close);
        ctx.font = `bold ${this.fontSize}px ${this.fontFamily}`;
        const metrics = ctx.measureText(label);
        const padX = 8;
        const tagH = this.fontSize + 6;
        const tagW = this.width - 4;
        // Tag background
        ctx.fillStyle = color;
        ctx.fillRect(x + 2, y - tagH / 2, tagW, tagH);
        // Label text
        ctx.fillStyle = theme.lastPriceTagText || '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + 2 + tagW / 2, y);
    }
}
