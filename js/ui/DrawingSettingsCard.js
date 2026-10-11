/**
 * DrawingSettingsCard.js
 * Floating popup card that appears when a drawing is selected.
 *
 * Features:
 * - Color picker (line color + fill color)
 * - Line width slider (1-5)
 * - Line style dropdown (solid, dashed, dotted, long-dash)
 * - Opacity slider
 * - Text input + toggle (show text label on the drawing)
 * - Extend toggle (for lines that should extend to chart edges)
 * - Lock toggle (prevent accidental edits)
 * - Delete button
 * - Close button
 *
 * The card is anchored near the selected drawing's first anchor.
 */
import { DomUtils } from '../utils/DomUtils.js';

const PALETTE = [
    '#2962ff', '#f23645', '#089981', '#ff9800', '#9c27b0',
    '#00bcd4', '#ffeb3b', '#e91e63', '#4caf50', '#ffffff',
    '#888888', '#000000'
];

export class DrawingSettingsCard {
    constructor(container, engine) {
        this.container = container;
        this.engine = engine;
        this.drawing = null;
        this.element = DomUtils.el('div', { class: 'ac-settings-card', style: 'display:none' });
        container.appendChild(this.element);
        this._build();
        // Subscribe to selection changes
        engine.drawingManager.onSelectionChange = (d) => this.show(d);
    }

    _build() {
        this.element.innerHTML = `
            <div class="ac-sc-header">
                <span class="ac-sc-title">Drawing Settings</span>
                <button class="ac-sc-close" title="Close">×</button>
            </div>
            <div class="ac-sc-body">
                <div class="ac-sc-row">
                    <label>Color</label>
                    <div class="ac-sc-palette" data-field="color"></div>
                </div>
                <div class="ac-sc-row">
                    <label>Fill</label>
                    <div class="ac-sc-palette" data-field="fillColor"></div>
                </div>
                <div class="ac-sc-row">
                    <label>Width</label>
                    <input type="range" min="1" max="6" step="0.5" class="ac-sc-range" data-field="lineWidth">
                    <span class="ac-sc-val" data-show="lineWidth"></span>
                </div>
                <div class="ac-sc-row">
                    <label>Style</label>
                    <select class="ac-sc-select" data-field="lineStyle">
                        <option value="solid">Solid</option>
                        <option value="dashed">Dashed</option>
                        <option value="dotted">Dotted</option>
                        <option value="long-dash">Long Dash</option>
                    </select>
                </div>
                <div class="ac-sc-row">
                    <label>Opacity</label>
                    <input type="range" min="0.1" max="1" step="0.1" class="ac-sc-range" data-field="opacity">
                    <span class="ac-sc-val" data-show="opacity"></span>
                </div>
                <div class="ac-sc-row">
                    <label>Text</label>
                    <input type="text" class="ac-sc-text" data-field="text" placeholder="Label text">
                    <label class="ac-sc-checkbox"><input type="checkbox" data-field="showText"> Show</label>
                </div>
                <div class="ac-sc-row ac-sc-toggles">
                    <label class="ac-sc-checkbox"><input type="checkbox" data-field="extend"> Extend</label>
                    <label class="ac-sc-checkbox"><input type="checkbox" data-field="locked"> Lock</label>
                    <label class="ac-sc-checkbox"><input type="checkbox" data-field="visible"> Visible</label>
                </div>
            </div>
            <div class="ac-sc-footer">
                <button class="ac-sc-btn ac-sc-btn-danger" data-action="delete">Delete</button>
                <button class="ac-sc-btn" data-action="clone">Clone</button>
            </div>
        `;

        // Build palettes
        for (const field of ['color', 'fillColor']) {
            const pal = this.element.querySelector(`[data-field="${field}"]`);
            for (const c of PALETTE) {
                const sw = DomUtils.el('button', {
                    class: 'ac-sc-swatch',
                    style: `background:${c}`,
                    dataset: { color: c, field }
                });
                sw.addEventListener('click', () => this._setField(field, c));
                pal.appendChild(sw);
            }
            // "None" option for fill
            if (field === 'fillColor') {
                const none = DomUtils.el('button', {
                    class: 'ac-sc-swatch ac-sc-swatch-none',
                    dataset: { color: '', field }
                }, '∅');
                none.addEventListener('click', () => this._setField(field, null));
                pal.appendChild(none);
            }
        }

        // Wire inputs
        this.element.querySelectorAll('[data-field]').forEach(el => {
            if (el.classList.contains('ac-sc-swatch')) return;
            const field = el.dataset.field;
            el.addEventListener('input', () => this._setField(field, el.type === 'checkbox' ? el.checked : el.value));
            el.addEventListener('change', () => this._setField(field, el.type === 'checkbox' ? el.checked : el.value));
        });

        // Buttons
        this.element.querySelector('.ac-sc-close').addEventListener('click', () => this.hide());
        this.element.querySelector('[data-action="delete"]').addEventListener('click', () => this._delete());
        this.element.querySelector('[data-action="clone"]').addEventListener('click', () => this._clone());
    }

    _setField(field, value) {
        if (!this.drawing) return;
        this.drawing[field] = value;
        if (field === 'opacity') this.drawing.opacity = parseFloat(value);
        if (field === 'lineWidth') this.drawing.lineWidth = parseFloat(value);
        this._syncDisplay();
        this.engine.requestRender();
    }

    _syncDisplay() {
        if (!this.drawing) return;
        const d = this.drawing;
        this.element.querySelector('[data-show="lineWidth"]').textContent = d.lineWidth;
        this.element.querySelector('[data-show="opacity"]').textContent = Math.round(d.opacity * 100) + '%';
        // Update input values (without re-triggering)
        this.element.querySelectorAll('[data-field]').forEach(el => {
            if (el.classList.contains('ac-sc-swatch')) return;
            const f = el.dataset.field;
            if (f === 'color' || f === 'fillColor' || f === 'text' || f === 'lineStyle') return;
            if (el.type === 'checkbox') el.checked = !!d[f];
            else el.value = d[f];
        });
        // Highlight active swatch
        for (const field of ['color', 'fillColor']) {
            this.element.querySelectorAll(`[data-field="${field}"]`).forEach(sw => {
                sw.classList.toggle('active', sw.dataset.color === (d[field] || ''));
            });
        }
    }

    show(drawing) {
        if (!drawing) { this.hide(); return; }
        this.drawing = drawing;
        this.element.style.display = 'block';
        this._syncDisplay();
        this._position();
    }

    hide() {
        this.element.style.display = 'none';
        this.drawing = null;
    }

    _position() {
        if (!this.drawing || !this.drawing.anchors.length) return;
        const vp = this.engine.viewport;
        const p = this.drawing._anchorToScreen(this.drawing.anchors[0], vp);
        const rect = this.element.getBoundingClientRect();
        const cardW = rect.width || 280;
        const cardH = rect.height || 380;
        // Position above and to the right of the anchor, fall back if no room
        let x = p.x + 14;
        let y = p.y - cardH - 10;
        if (y < 8) y = p.y + 14;
        if (x + cardW > vp.width - 80) x = p.x - cardW - 14;
        if (x < 8) x = 8;
        this.element.style.left = x + 'px';
        this.element.style.top = y + 'px';
    }

    _delete() {
        if (!this.drawing) return;
        this.engine.drawingManager.remove(this.drawing.id);
        this.hide();
        this.engine.requestRender();
    }

    _clone() {
        if (!this.drawing) return;
        const json = this.drawing.toJSON();
        delete json.id;
        const factory = this.engine.drawingManager._toolFactories[json.type];
        if (factory) {
            const clone = factory(json);
            // Offset anchors slightly
            clone.anchors.forEach(a => a.index += 5);
            this.engine.drawingManager.add(clone);
            this.engine.requestRender();
        }
    }
}
