/**
 * Crosshair.js
 * Renders the crosshair (vertical + horizontal guide lines) that follows
 * the cursor, plus axis price/time labels at the crosshair position.
 */
import { MathUtils } from '../utils/MathUtils.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export class Crosshair {
    constructor(options = {}) {
        this.visible = false;
        this.x = 0;
        this.y = 0;
        this.snapToBar = options.snapToBar !== false;
        this.showPriceLabel = options.showPriceLabel !== false;
        this.showTimeLabel = options.showTimeLabel !== false;
        this._priceScaleWidth = 70;
        this._timeScaleHeight = 28;
    }

    /**
     * Update the crosshair position from raw pointer coordinates.
     */
    update(x, y, inside) {
        this.x = x;
        this.y = y;
        this.visible = inside;
    }

    /**
     * Render the crosshair. Snaps the vertical line to the nearest bar center.
     */
    draw(ctx, viewport, dm, theme) {
        if (!this.visible) return;
        const snappedX = this.snapToBar
            ? this._snapX(viewport)
            : this.x;
        const snappedIdx = viewport.xToIndex(snappedX);

        ctx.save();
        ctx.strokeStyle = theme.crosshairColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);

        // Vertical line
        ctx.beginPath();
        ctx.moveTo(snappedX + 0.5, 0);
        ctx.lineTo(snappedX + 0.5, viewport.height - this._timeScaleHeight);
        ctx.stroke();

        // Horizontal line (only inside price pane)
        if (this.y < viewport.priceHeight) {
            ctx.beginPath();
            ctx.moveTo(0, this.y + 0.5);
            ctx.lineTo(viewport.width - this._priceScaleWidth, this.y + 0.5);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Price label on the right axis
        if (this.showPriceLabel && this.y < viewport.priceHeight) {
            const price = viewport.yToPrice(this.y);
            const label = MathUtils.formatPrice(price);
            ctx.font = "bold 11px 'JetBrains Mono', monospace";
            const metrics = ctx.measureText(label);
            const tagW = metrics.width + 14;
            const tagH = 18;
            const tx = viewport.width - this._priceScaleWidth;
            const ty = this.y - tagH / 2;
            ctx.fillStyle = theme.crosshairLabelBg;
            ctx.fillRect(tx, ty, tagW, tagH);
            ctx.fillStyle = theme.crosshairLabelText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, tx + tagW / 2, ty + tagH / 2);
        }

        // Time label on the bottom axis
        if (this.showTimeLabel) {
            const idx = Math.round(snappedIdx);
            if (idx >= 0 && idx < dm.size) {
                const time = dm.times[idx];
                const d = new Date(time);
                const label = this._formatTime(d, dm.interval);
                ctx.font = "bold 11px 'JetBrains Mono', monospace";
                const metrics = ctx.measureText(label);
                const tagW = metrics.width + 14;
                const tagH = 18;
                const tx = Math.max(0, Math.min(viewport.width - this._priceScaleWidth - tagW, snappedX - tagW / 2));
                const ty = viewport.height - this._timeScaleHeight;
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

    _snapX(viewport) {
        const idx = viewport.xToIndex(this.x);
        const snapped = Math.round(idx);
        return viewport.indexToX(snapped) + viewport.barSpacing / 2;
    }

    _formatTime(d, interval) {
        const pad = (n) => String(n).padStart(2, '0');
        if (interval < 24 * 60 * 60 * 1000) {
            return pad(d.getHours()) + ':' + pad(d.getMinutes());
        } else {
            return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
        }
    }
}
