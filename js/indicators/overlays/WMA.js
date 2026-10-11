/**
 * WMA.js
 * Weighted (linearly-weighted) Moving Average overlay.
 */
import { IndicatorBase } from '../IndicatorBase.js';

export class WMA extends IndicatorBase {
    constructor(opts = {}) {
        super(opts);
        this.name = 'WMA';
        this.type = 'overlay';
        this.color = opts.color || '#2962ff';
    }
    defaultOptions() { return { period: 14 }; }
    calculate(dm) {
        const { closes } = dm.raw();
        this.buffers.wma = this._wma(closes, this.options.period);
    }
    draw(ctx, viewport, dm, pane, theme) {
        this.ensureCalculated(dm);
        this._drawLine(ctx, viewport, this.buffers.wma, this.color, this.lineWidth, pane);
    }
}
