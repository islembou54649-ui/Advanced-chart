/**
 * DrawingSettingsCard.js
 * Compact HORIZONTAL popup card that appears when a drawing is selected
 * (via left-click selection OR right-click on a drawing).
 *
 * Layout: single horizontal row with inline controls:
 *   [✕] | Color: ▢▢▢▢▢ | Width: ━━●━━ | Style: [Solid▾] | Text: [____] [👁] | [🗑 Delete]
 *
 * Designed to be unobtrusive — appears near the drawing, doesn't block the chart.
 */
import { DomUtils } from '../utils/DomUtils.js';

const PALETTE = ['#2962ff', '#f23645', '#089981', '#ff9800', '#9c27b0', '#00bcd4'];

const LINE_STYLES = [
    { value: 'solid', label: '——' },
    { value: 'dashed', label: '– –' },
    { value: 'dotted', label: '···' },
    { value: 'long-dash', label: '— –' }
];

export class DrawingSettingsCard {
    constructor(container, engine) {
        this.container = container;
        this.engine = engine;
        this.drawing = null;
        this.element = DomUtils.el('div', { class: 'ac-settings-card-h', style: 'display:none' });
        container.appendChild(this.element);
        this._build();
        engine.drawingManager.onSelectionChange = (d) => {
            if (d) this.show(d);
            else this.hide();
        };
        // Hide when clicking outside the card
        document.addEventListener('pointerdown', (e) => {
            if (!this.drawing) return;
            if (e.target.closest('.ac-settings-card-h')) return;
            // If clicked on a different drawing, the selectionChange handler will update
            // If clicked on empty chart, selectionChange fires with null → hide
        });
    }

    _build() {
        this.element.innerHTML = `
            <button class="ac-sch-close" title="Close">×</button>
            <div class="ac-sch-group">
                <span class="ac-sch-label">Color</span>
                <div class="ac-sch-palette" data-field="color"></div>
            </div>
            <div class="ac-sch-sep"></div>
            <div class="ac-sch-group">
                <span class="ac-sch-label">Width</span>
                <input type="range" min="1" max="6" step="0.5" class="ac-sch-range" data-field="lineWidth" title="Line width">
            </div>
            <div class="ac-sch-sep"></div>
            <div class="ac-sch-group">
                <span class="ac-sch-label">Style</span>
                <select class="ac-sch-select" data-field="lineStyle">
                    ${LINE_STYLES.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
                </select>
            </div>
            <div class="ac-sch-sep"></div>
            <div class="ac-sch-group">
                <span class="ac-sch-label">Text</span>
                <input type="text" class="ac-sch-text" data-field="text" placeholder="Label..." maxlength="40">
                <label class="ac-sch-checkbox" title="Show text"><input type="checkbox" data-field="showText"></label>
            </div>
            <div class="ac-sch-sep"></div>
            <div class="ac-sch-group ac-sch-toggles">
                <label class="ac-sch-checkbox" title="Extend line"><input type="checkbox" data-field="extend"> ⟶</label>
                <label class="ac-sch-checkbox" title="Lock"><input type="checkbox" data-field="locked"> 🔒</label>
            </div>
            <div class="ac-sch-sep"></div>
            <div class="ac-sch-actions">
                <button class="ac-sch-btn ac-sch-btn-clone" title="Clone" data-action="clone">⧉</button>
                <button class="ac-sch-btn ac-sch-btn-danger" title="Delete" data-action="delete">🗑</button>
            </div>
        `;
        // Build color palette
        const pal = this.element.querySelector('[data-field="color"]');
        for (const c of PALETTE) {
            const sw = DomUtils.el('button', { class: 'ac-sch-swatch', style: `background:${c}`, dataset: { color: c } });
            sw.addEventListener('click', () => this._setField('color', c));
            pal.appendChild(sw);
        }
        // Wire inputs
        this.element.querySelectorAll('[data-field]').forEach(el => {
            if (el.classList.contains('ac-sch-swatch')) return;
            const field = el.dataset.field;
            const evt = (el.tagName === 'SELECT') ? 'change' : 'input';
            el.addEventListener(evt, () => {
                const v = el.type === 'checkbox' ? el.checked : el.value;
                this._setField(field, v);
            });
        });
        // Buttons
        this.element.querySelector('.ac-sch-close').addEventListener('click', () => this.hide());
        this.element.querySelector('[data-action="delete"]').addEventListener('click', () => this._delete());
        this.element.querySelector('[data-action="clone"]').addEventListener('click', () => this._clone());
    }

    _setField(field, value) {
        if (!this.drawing) return;
        if (field === 'lineWidth') this.drawing.lineWidth = parseFloat(value);
        else if (field === 'opacity') this.drawing.opacity = parseFloat(value);
        else this.drawing[field] = value;
        this.engine.requestRender();
    }

    _syncDisplay() {
        if (!this.drawing) return;
        const d = this.drawing;
        // Sync inputs
        this.element.querySelectorAll('[data-field]').forEach(el => {
            if (el.classList.contains('ac-sch-swatch')) return;
            const f = el.dataset.field;
            if (el.type === 'checkbox') el.checked = !!d[f];
            else if (el.tagName === 'SELECT') el.value = d[f] || 'solid';
            else if (f === 'lineWidth') el.value = d.lineWidth;
            else if (f === 'text') el.value = d.text || '';
        });
        // Highlight active color swatch
        this.element.querySelectorAll('.ac-sch-swatch').forEach(sw => {
            sw.classList.toggle('active', sw.dataset.color === d.color);
        });
    }

    show(drawing) {
        if (!drawing) { this.hide(); return; }
        this.drawing = drawing;
        this.element.style.display = 'flex';
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
        // Position above the drawing's first anchor, centered horizontally
        const rect = this.element.getBoundingClientRect();
        const cardW = rect.width || 600;
        const cardH = rect.height || 40;
        let x = p.x - cardW / 2;
        let y = p.y - cardH - 10;
        // Clamp to viewport
        if (y < 8) y = p.y + 14;
        if (x < 8) x = 8;
        if (x + cardW > vp.width - 80) x = vp.width - 80 - cardW;
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
            clone.anchors.forEach(a => a.index += 5);
            this.engine.drawingManager.add(clone);
            this.engine.requestRender();
        }
    }
}
