/**
 * MathUtils.js
 * Utility functions for mathematical operations used throughout the chart engine.
 * All functions are pure and side-effect free for performance.
 */
export const MathUtils = {
    /**
     * Clamp a value between min and max.
     */
    clamp(value, min, max) {
        if (value < min) return min;
        if (value > max) return max;
        return value;
    },

    /**
     * Linear interpolation between a and b.
     */
    lerp(a, b, t) {
        return a + (b - a) * t;
    },

    /**
     * Inverse linear interpolation - returns t such that lerp(a, b, t) = value.
     */
    invLerp(a, b, value) {
        if (a === b) return 0;
        return (value - a) / (b - a);
    },

    /**
     * Round to a given number of decimal places.
     */
    round(value, decimals = 0) {
        const f = Math.pow(10, decimals);
        return Math.round(value * f) / f;
    },

    /**
     * Nice number algorithm - rounds a value up to a "nice" number (1, 2, 5, 10...).
     * Used for grid line spacing.
     */
    niceNumber(value, round) {
        if (value <= 0) return 1;
        const exp = Math.floor(Math.log10(value));
        const f = value / Math.pow(10, exp);
        let nf;
        if (round) {
            if (f < 1.5) nf = 1;
            else if (f < 3) nf = 2;
            else if (f < 7) nf = 5;
            else nf = 10;
        } else {
            if (f <= 1) nf = 1;
            else if (f <= 2) nf = 2;
            else if (f <= 5) nf = 5;
            else nf = 10;
        }
        return nf * Math.pow(10, exp);
    },

    /**
     * Generate nice tick values between min and max.
     */
    niceTicks(min, max, maxTicks = 8) {
        if (min === max) {
            min -= 1;
            max += 1;
        }
        const range = this.niceNumber(max - min, false);
        const step = this.niceNumber(range / (maxTicks - 1), true);
        const niceMin = Math.floor(min / step) * step;
        const niceMax = Math.ceil(max / step) * step;
        const ticks = [];
        for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
            ticks.push(v);
        }
        return { ticks, step, min: niceMin, max: niceMax };
    },

    /**
     * Format a number with appropriate precision.
     */
    formatNumber(value, precision = 2) {
        if (!isFinite(value)) return '—';
        const abs = Math.abs(value);
        if (abs >= 1e9) return (value / 1e9).toFixed(2) + 'B';
        if (abs >= 1e6) return (value / 1e6).toFixed(2) + 'M';
        if (abs >= 1e3) return (value / 1e3).toFixed(2) + 'K';
        return value.toFixed(precision);
    },

    /**
     * Format price with adaptive decimals based on magnitude.
     */
    formatPrice(value) {
        if (!isFinite(value)) return '—';
        const abs = Math.abs(value);
        let decimals;
        if (abs >= 1000) decimals = 2;
        else if (abs >= 1) decimals = 4;
        else if (abs >= 0.01) decimals = 6;
        else decimals = 8;
        return value.toFixed(decimals);
    },

    /**
     * Distance between two points.
     */
    distance(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    },

    /**
     * Check if a point is inside a rectangle.
     */
    pointInRect(px, py, x, y, w, h) {
        return px >= x && px <= x + w && py >= y && py <= y + h;
    },

    /**
     * Throttle a function call to run at most once per animation frame.
     */
    rafThrottle(fn) {
        let scheduled = false;
        let lastArgs = null;
        let lastThis = null;
        return function (...args) {
            lastArgs = args;
            lastThis = this;
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                fn.apply(lastThis, lastArgs);
            });
        };
    },

    /**
     * Debounce a function.
     */
    debounce(fn, delay) {
        let timer = null;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }
};
