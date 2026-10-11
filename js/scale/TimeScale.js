/**
 * TimeScale.js
 * Renders the time (X) axis at the bottom of the chart.
 * Picks sensible time tick spacing based on the visible range and bar spacing.
 *
 * Supports multiple interval formats: intraday (1m, 5m, 1h), daily, weekly.
 */
import { MathUtils } from '../utils/MathUtils.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export class TimeScale {
    constructor(options = {}) {
        this.height = options.height || 28;
        this.fontSize = options.fontSize || 11;
        this.fontFamily = options.fontFamily || "'JetBrains Mono', 'Consolas', monospace";
        this.minTickSpacing = options.minTickSpacing || 70; // min px between labels
    }

    /**
     * Determine the appropriate time-tick spacing for the current view.
     * Returns a function (time) => string that formats a timestamp.
     */
    _pickFormatter(interval) {
        // interval in ms
        if (interval < 60 * 60 * 1000) {
            // intraday < 1h: show HH:MM
            return (t) => {
                const d = new Date(t);
                return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
            };
        } else if (interval < 24 * 60 * 60 * 1000) {
            // intraday >= 1h: show HH:MM or DD MMM
            return (t) => {
                const d = new Date(t);
                return String(d.getHours()).padStart(2, '0') + ':00';
            };
        } else if (interval < 7 * 24 * 60 * 60 * 1000) {
            // daily: show DD MMM
            return (t) => {
                const d = new Date(t);
                return d.getDate() + ' ' + MONTHS[d.getMonth()];
            };
        } else {
            // weekly/monthly: show MMM YY
            return (t) => {
                const d = new Date(t);
                return MONTHS[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
            };
        }
    }

    /**
     * Draw the time axis and grid lines.
     */
    draw(ctx, viewport, dm, theme) {
        if (dm.size === 0) return;
        const y = viewport.height - this.height;
        const w = viewport.width - 70; // subtract price scale width

        // Background
        ctx.fillStyle = theme.timeScaleBg;
        ctx.fillRect(0, y, viewport.width, this.height);

        // Top border
        ctx.strokeStyle = theme.timeScaleBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(viewport.width, y + 0.5);
        ctx.stroke();

        // Determine which bars to label
        const formatter = this._pickFormatter(dm.interval);
        const barSpacingPx = viewport.barSpacing;
        const step = Math.max(1, Math.ceil(this.minTickSpacing / barSpacingPx));

        // Find first visible bar
        const leftIdx = Math.floor(viewport.leftEdge);
        const rightIdx = Math.ceil(viewport.rightEdge);

        // Snap the starting index so labels are stable as you pan
        const startIdx = Math.ceil(leftIdx / step) * step;

        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        ctx.fillStyle = theme.timeScaleText;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let i = startIdx; i <= rightIdx; i += step) {
            if (i < 0 || i >= dm.size) continue;
            const x = viewport.indexToX(i) + viewport.barSpacing / 2;
            if (x < 0 || x > w) continue;
            const time = dm.times[i];
            const label = formatter(time);

            // Vertical gridline
            ctx.strokeStyle = theme.gridLine;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(x + 0.5, 0);
            ctx.lineTo(x + 0.5, y);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = theme.timeScaleText;
            ctx.fillText(label, x, y + this.height / 2);
        }
    }
}
