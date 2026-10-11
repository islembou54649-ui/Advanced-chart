/**
 * app.js
 * Application entry point. Wires up the chart engine to the DOM.
 *
 * This is intentionally minimal - the ChartEngine class encapsulates all logic.
 * Future features (indicators, more tools, settings) will be added here.
 */
import { ChartEngine } from './core/ChartEngine.js';

const container = document.getElementById('chart-root');
const engine = new ChartEngine(container, {
    symbol: 'BTCUSDT',
    theme: 'dark'
});

engine.init();

// Keyboard shortcuts for tool selection
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    const map = {
        'v': 'cursor', 'c': 'crosshair', 't': 'trendline',
        'h': 'hline', 'r': 'rectangle', 'f': 'fib', 'x': 'text'
    };
    if (map[e.key.toLowerCase()]) {
        engine.setActiveTool(map[e.key.toLowerCase()] === 'cursor' ? null : map[e.key.toLowerCase()]);
        if (map[e.key.toLowerCase()] === 'cursor') engine.toolbar.setActiveTool('cursor');
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        engine.drawingManager.deleteSelected();
        engine.requestRender();
    }
});

// Make available for debugging
window.chartEngine = engine;
console.log('%cAdvanced Chart v0.2', 'font-size:14px;font-weight:bold;color:#2962ff');
console.log('Engine available at window.chartEngine');
