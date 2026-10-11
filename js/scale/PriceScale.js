/**
 * PriceScale.js
 * Renders the price (Y) axis on the right side of the chart.
 * Computes nice tick values and draws labels with proper formatting.
 *
 * Also provides the price-to-Y mapping (delegated to Viewport for autoscaling state).
 */
import { MathUtils } from '../utils/MathUtils.js';

export class PriceScale {
    constructor(options = {}) {
        this.width = options.width || 70;
        this.fontSize = options.fontSize || 11;
        this.fontFamily = options.fontFamily || "'JetBrains Mono', 'Consolas', monospace";
        this.tickCount = options.tickCount || 8;
        this.align = options.align || 'right';
    }

    /**
     * Draw the price axis labels.
     * @param {CanvasRenderingContext2D} ctx
     * @param {Viewport} viewport
     * @param {Theme} theme
     */
    draw(ctx, viewport, theme) {
        const x = viewport.width - this.width;
        const y = 0;
        const w = this.width;
        const h = viewport.priceHeight;

        // Background
        ctx.fillStyle = theme.priceScaleBg;
        ctx.fillRect(x, y, w, h);

        // Border line
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
            // Gridline on chart
            ctx.strokeStyle = theme.gridLine;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(0, py + 0.5);
            ctx.lineTo(x, py + 0.5);
            ctx.stroke();
            ctx.setLineDash([]);
            // Label
            const label = MathUtils.formatPrice(price);
            ctx.textAlign = this.align === 'right' ? 'right' : 'left';
            const tx = this.align === 'right' ? x + w - 6 : x + 6;
            ctx.fillText(label, tx, py);
        }

        // Last price line + label
        this._drawLastPriceLine(ctx, viewport, theme);
    }

    /**
     * Draw the horizontal line indicating the most recent close, plus a price tag.
     */
    _drawLastPriceLine(ctx, viewport, theme) {
        const dm = viewport._dm;
        if (!dm || dm.size === 0) return;
        const last = dm.get(dm.size - 1);
        if (!last) return;
        const y = viewport.priceToY(last.close);
        if (y < 0 || y > viewport.priceHeight) return;

        // Dashed line across chart
        ctx.strokeStyle = last.close >= last.open ? theme.upColor : theme.downColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(viewport.width - this.width, y + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price tag on the scale
        const x = viewport.width - this.width;
        const label = MathUtils.formatPrice(last.close);
        ctx.font = `bold ${this.fontSize}px ${this.fontFamily}`;
        const metrics = ctx.measureText(label);
        const padX = 6, padY = 3;
        const tagW = metrics.width + padX * 2;
        const tagH = this.fontSize + padY * 2;
        ctx.fillStyle = last.close >= last.open ? theme.upColor : theme.downColor;
        ctx.fillRect(x, y - tagH / 2, tagW, tagH);
        ctx.fillStyle = theme.lastPriceTagText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + tagW / 2, y);
    }
}
