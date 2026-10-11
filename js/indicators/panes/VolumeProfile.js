/**
 * VolumeProfile.js — Horizontal volume histogram (visible range only).
 *
 * Bins the visible candle range into ~30 price buckets; for each bucket we
 * accumulate up volume (close >= open) and down volume (close < open)
 * separately. Draws horizontal bars from the left edge:
 *   - up volume   : green bar   extending right, anchored at x=0
 *   - down volume : red    bar extending right, anchored at x=0 (translucent)
 * Both are drawn so that the dominant side is fully visible. The pane's
 * y-axis is set to the visible candle price range (see `visibleRange`) so
 * bars line up with their actual price level.
 */
import { IndicatorBase } from '../IndicatorBase.js';

export class VolumeProfile extends IndicatorBase {
    constructor(opts = {}) {
        super(opts);
        this.name = 'VolumeProfile';
        this.type = 'pane';
        this.color  = opts.color  || '#089981'; // up
        this.color2 = opts.color2 || '#f23645'; // down
    }
    defaultOptions() { return { buckets: 30, barWidthRatio: 0.5 }; }

    /**
     * Pane autoscale: return the visible candle price range so that the
     * horizontal bars line up with prices.
     */
    visibleRange(viewport, dm) {
        const { highs, lows } = dm.raw();
        const left = Math.max(0, Math.floor(viewport.leftEdge));
        const right = Math.min(highs.length - 1, Math.ceil(viewport.rightEdge));
        let min = Infinity, max = -Infinity;
        for (let i = left; i <= right; i++) {
            if (highs[i] > max) max = highs[i];
            if (lows[i]  < min) min = lows[i];
        }
        if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 };
        const pad = (max - min) * 0.05 || max * 0.01 || 1;
        return { min: min - pad, max: max + pad };
    }

    draw(ctx, viewport, dm, pane, theme) {
        this.ensureCalculated(dm);
        const { highs, lows, opens, closes, volumes } = dm.raw();
        const leftIdx = Math.max(0, Math.floor(viewport.leftEdge));
        const rightIdx = Math.min(highs.length - 1, Math.ceil(viewport.rightEdge));
        if (rightIdx < leftIdx) return;

        // Visible price range.
        let pMin = Infinity, pMax = -Infinity;
        for (let i = leftIdx; i <= rightIdx; i++) {
            if (highs[i] > pMax) pMax = highs[i];
            if (lows[i]  < pMin) pMin = lows[i];
        }
        if (!isFinite(pMin) || !isFinite(pMax) || pMax <= pMin) return;

        const NB = Math.max(2, this.options.buckets | 0);
        const bucketSize = (pMax - pMin) / NB;
        const upVol = new Float64Array(NB);
        const dnVol = new Float64Array(NB);
        for (let i = leftIdx; i <= rightIdx; i++) {
            // Bucket by typical price; volume attributed by candle direction.
            const tp = (highs[i] + lows[i] + closes[i]) / 3;
            let b = Math.floor((tp - pMin) / bucketSize);
            if (b < 0) b = 0;
            if (b >= NB) b = NB - 1;
            const isUp = closes[i] >= opens[i];
            if (isUp) upVol[b] += volumes[i];
            else      dnVol[b] += volumes[i];
        }
        let maxVol = 0;
        for (let i = 0; i < NB; i++) {
            if (upVol[i] > maxVol) maxVol = upVol[i];
            if (dnVol[i] > maxVol) maxVol = dnVol[i];
        }
        if (maxVol <= 0) return;

        const right = viewport.width - 70;
        const maxBarW = right * this.options.barWidthRatio;
        ctx.save();
        this._clipToPane(ctx, viewport, pane);
        for (let i = 0; i < NB; i++) {
            const priceLo = pMin + i * bucketSize;
            const priceHi = priceLo + bucketSize;
            const yLo = this._priceToY(priceLo, viewport, pane);
            const yHi = this._priceToY(priceHi, viewport, pane);
            const yTop = Math.min(yLo, yHi);
            const h = Math.max(1, Math.abs(yLo - yHi) - 0.5);
            // Up volume bar (translucent green).
            const wUp = (upVol[i] / maxVol) * maxBarW;
            if (wUp > 0) {
                ctx.fillStyle = this._withAlpha(this.color, 0.55);
                ctx.fillRect(0, yTop, wUp, h);
            }
            // Down volume bar (translucent red, overlaid).
            const wDn = (dnVol[i] / maxVol) * maxBarW;
            if (wDn > 0) {
                ctx.fillStyle = this._withAlpha(this.color2, 0.55);
                ctx.fillRect(0, yTop, wDn, h);
            }
            // Outline bar for the dominant side so its extent is readable.
            const domW = Math.max(wUp, wDn);
            if (domW > 0) {
                ctx.strokeStyle = (upVol[i] >= dnVol[i]) ? this.color : this.color2;
                ctx.lineWidth = 1;
                ctx.strokeRect(0.5, yTop + 0.5, domW - 1, h - 1);
            }
        }
        ctx.restore();
    }
}
