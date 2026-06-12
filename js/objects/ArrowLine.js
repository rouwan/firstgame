/**
 * ArrowLine — 箭头线游戏对象
 *
 * 【定义】箭头线 = 尾巴点 + 路径 → Step 对象数组
 */

// =========================================================================
// Step — 步对象（点阵上的最小单元：一条有向边）
// =========================================================================
class Step {

    constructor(startCol, startRow, endCol, endRow, dir, isLast, DIR) {
        this.startCol = startCol;
        this.startRow = startRow;
        this.endCol   = endCol;
        this.endRow   = endRow;
        this.dir      = dir;
        this.angle    = DIR[dir].angle;
        this.texture  = isLast ? 'arrow' : 'segment';
        this.edgeKey  = Step.makeEdgeKey(startCol, startRow, endCol, endRow);
    }

    get centerCol() { return (this.startCol + this.endCol) / 2; }
    get centerRow() { return (this.startRow + this.endRow) / 2; }

    static makeEdgeKey(c1, r1, c2, r2) {
        if (c1 < c2 || (c1 === c2 && r1 < r2)) return `${c1},${r1}-${c2},${r2}`;
        return `${c2},${r2}-${c1},${r1}`;
    }
}

// =========================================================================
// 方向映射
// =========================================================================
const DIR_MAP = {
    right: { dx: 1, dy: 0 },
    down:  { dx: 0, dy: 1 },
    left:  { dx: -1, dy: 0 },
    up:    { dx: 0, dy: -1 },
};

// =========================================================================
// ArrowLine — 箭头线
// =========================================================================
class ArrowLine {

    static DEV = true;
    static _all = [];

    constructor(scene, container, dotMatrix, tailCol, tailRow, path, toX, toY, DIR, label = '') {
        this.scene = scene;
        this.container = container;
        this.dotMatrix = dotMatrix;

        // ======== 核心数据 ========
        this.tailCol = tailCol;
        this.tailRow = tailRow;
        this.path    = path;
        this.label   = label;

        // ======== 保存坐标映射 ========
        this._toX = toX;
        this._toY = toY;
        this._DIR = DIR;

        // ======== ① 展开：路径 → Step[] ========
        this.steps = this._expand(tailCol, tailRow, path, DIR);

        // ======== 头尖点 + 飞行方向 ========
        this.headCol = this.steps[0].endCol;
        this.headRow = this.steps[0].endRow;
        this.flyDir  = this.steps[0].dir;

        // ======== 注册格点（向 DotMatrix 报告所有覆盖的格点）========
        this._registerPoints();

        // ======== ②~⑦ 绘制 ========
        this._buildImages(toX, toY);

        // ======== ⑨ 标签 ========
        if (ArrowLine.DEV && label) this._makeLabel(toX, toY);

        // ======== 全局注册 ========
        ArrowLine._all.push(this);
    }

    // =========================================================================
    // _expand — 路径 → Step[]
    // =========================================================================
    _expand(tailCol, tailRow, path, DIR) {
        const steps = [];
        let col = tailCol;
        let row = tailRow;

        for (let vi = 0; vi < path.length; vi++) {
            const vec = path[vi];
            const isLastVector = (vi === path.length - 1);
            const d = DIR[vec.dir];

            for (let si = 0; si < vec.count; si++) {
                const nextCol = col + d.dx;
                const nextRow = row + d.dy;
                const isLastStep = isLastVector && (si === vec.count - 1);
                steps.push(new Step(col, row, nextCol, nextRow, vec.dir, isLastStep, DIR));
                col = nextCol;
                row = nextRow;
            }
        }

        return steps.reverse();  // [0]=头, [N-1]=尾
    }

    // =========================================================================
    // _registerPoints — 向 DotMatrix 注册本线覆盖的所有格点
    // =========================================================================
    _registerPoints() {
        // 箭头尖端（steps[0].endCol/Row）是飞行第一步才会进入的点，
        // 可能落在邻区甚至棋盘外——不注册，防止与邻区线冲突
        const tipCol = this.steps[0].endCol;
        const tipRow = this.steps[0].endRow;

        const seen = new Set();
        for (const step of this.steps) {
            const k1 = `${step.startCol},${step.startRow}`;
            if (!seen.has(k1)) {
                seen.add(k1);
                const r = this.dotMatrix.occupy(step.startCol, step.startRow, this);
                if (!r.ok) console.warn(`[ArrowLine] constructor conflict at ${k1}`);
            }
            const k2 = `${step.endCol},${step.endRow}`;
            if (!seen.has(k2) && (step.endCol !== tipCol || step.endRow !== tipRow)) {
                seen.add(k2);
                const r = this.dotMatrix.occupy(step.endCol, step.endRow, this);
                if (!r.ok) console.warn(`[ArrowLine] constructor conflict at ${k2}`);
            }
        }
    }

    // =========================================================================
    // _buildImages
    // =========================================================================
    _buildImages(toX, toY) {
        this.images = [];
        for (const step of this.steps) {
            const img = this.scene.add.image(toX(step.centerCol), toY(step.centerRow), step.texture)
                .setAngle(step.angle)
                .setInteractive({ useHandCursor: true });
            img.on('pointerdown', () => this.advance());
            this.container.add(img);
            this.images.push(img);
        }
    }

    // =========================================================================
    // advance — 前进（两阶段算法：移动 + 标箭头）
    // =========================================================================
    advance() {
        if (this._moving) return;
        this._moving = true;

        const d = DIR_MAP[this.flyDir];
        const stepMs = CONFIG.ARROW_LINE.STEP_DURATION;

        const tick = () => {
            if (this.steps.length === 0) return;

            const oldHead = this.steps[0];
            const oldTail = this.steps[this.steps.length - 1];

            const newEndCol = oldHead.endCol + d.dx;
            const newEndRow = oldHead.endRow + d.dy;

            // ===== ① 碰撞检测：向 DotMatrix 查询新头部端点是否被占 =====
            const blocker = this.dotMatrix.getOccupant(newEndCol, newEndRow);
            if (blocker && blocker !== this) {
                this._onOverlap(blocker);
                return;
            }

            // ===== ② 占用新头部端点 =====
            this.dotMatrix.occupy(newEndCol, newEndRow, this);

            // ===== ③ 移动：头进尾缩 =====
            const newHead = new Step(
                oldHead.endCol, oldHead.endRow,
                newEndCol, newEndRow,
                this.flyDir, true, this._DIR
            );
            this.steps.pop();
            this.steps.unshift(newHead);
            this.headCol = newEndCol;
            this.headRow = newEndRow;

            // ===== ④ 释放旧尾部起点 =====
            this.dotMatrix.release(oldTail.startCol, oldTail.startRow, this);

            // ===== ⑤ 标箭头 =====
            this.steps[0].texture = 'arrow';
            for (let i = 1; i < this.steps.length; i++) {
                this.steps[i].texture = 'segment';
            }

            // ===== ⑥ 重绘 =====
            this.images.forEach(img => img.destroy());
            this.images = [];
            this._buildImages(this._toX, this._toY);
            if (this._labelImg) { this._labelImg.destroy(); this._labelImg = null; }
            if (ArrowLine.DEV && this.label) this._makeLabel(this._toX, this._toY);

            // ===== ⑦ 结束：尾离开点阵 =====
            const tail = this.steps[this.steps.length - 1];
            if (!this._inside(tail.startCol, tail.startRow) &&
                !this._inside(tail.endCol, tail.endRow)) {
                this._dispose();
                return;
            }

            this.scene.time.delayedCall(stepMs, tick);
        };

        tick();
    }

    // =========================================================================
    // retreat — 后退到指定点，不传参则回初始尾巴点
    // =========================================================================
    retreat(targetCol, targetRow) {
        if (this._moving) return;
        this._moving = true;
        const tc = targetCol ?? this.tailCol;
        const tr = targetRow ?? this.tailRow;
        this._retreat(tc, tr);
    }

    // =========================================================================
    // _retreat — 后退到目标点
    // =========================================================================
    _retreat(targetCol, targetRow) {
        const stepMs = CONFIG.ARROW_LINE.STEP_DURATION;

        const tick = () => {
            if (this.steps.length === 0) return;

            const tail = this.steps[this.steps.length - 1];
            if (tail.startCol === targetCol && tail.startRow === targetRow) return;

            const d = DIR_MAP[tail.dir];
            const oldHead = this.steps[0];

            const newTail = new Step(
                tail.startCol - d.dx, tail.startRow - d.dy,
                tail.startCol, tail.startRow,
                tail.dir, false, this._DIR
            );

            // ① 释放旧头部的起点（该点不再被任何步覆盖）
            this.dotMatrix.release(oldHead.startCol, oldHead.startRow, this);

            // ② 占用新尾部的起点（不检查冲突，撤退只走自己的旧领地）
            this.dotMatrix.occupy(newTail.startCol, newTail.startRow, this);

            // ③ 移动：去头加尾
            this.steps.shift();
            this.steps.push(newTail);
            this.tailCol = newTail.startCol;
            this.tailRow = newTail.startRow;

            this.steps[0].texture = 'arrow';
            for (let i = 1; i < this.steps.length; i++) this.steps[i].texture = 'segment';

            this.headCol = this.steps[0].endCol;
            this.headRow = this.steps[0].endRow;

            this.images.forEach(img => img.destroy());
            this.images = [];
            this._buildImages(this._toX, this._toY);
            if (this._labelImg) { this._labelImg.destroy(); this._labelImg = null; }
            if (ArrowLine.DEV && this.label) this._makeLabel(this._toX, this._toY);

            this.scene.time.delayedCall(stepMs, tick);
        };

        tick();
    }

    // =========================================================================
    // _onOverlap — 撞到别人
    // =========================================================================
    _onOverlap(blocker) {
        this._moving = false;
        this.images.forEach(img => img.setTintFill(0xff4444));
        blocker._onHit();
        this._retreat(this.tailCol, this.tailRow);
    }

    // =========================================================================
    // _onHit — 被别人撞
    // =========================================================================
    _onHit() {
        this.images.forEach(img => img.setTintFill(0xff4444));

        const holdMs = 300;
        const fadeMs = 1000;

        this.scene.time.delayedCall(holdMs, () => {
            const dummy = { t: 0 };
            this.scene.tweens.add({
                targets: dummy,
                t: 1,
                duration: fadeMs,
                ease: 'Sine.easeOut',
                onUpdate: () => {
                    const r = Math.round(0xff - dummy.t * (0xff - 0x1A));
                    const g = Math.round(0x44 - dummy.t * (0x44 - 0x1A));
                    const b = Math.round(0x44 - dummy.t * (0x44 - 0x1A));
                    const color = (r << 16) | (g << 8) | b;
                    this.images.forEach(img => img.setTintFill(color));
                },
                onComplete: () => {
                    this.images.forEach(img => img.clearTint());
                },
            });
        });
    }

    // =========================================================================
    // isInside
    // =========================================================================
    isInside() {
        const maxCol = CONFIG.MATRIX.COLS - 1;
        const maxRow = CONFIG.MATRIX.ROWS - 1;
        for (const step of this.steps) {
            if (!this._inside(step.startCol, step.startRow, maxCol, maxRow)) return false;
            if (!this._inside(step.endCol, step.endRow, maxCol, maxRow)) return false;
        }
        return true;
    }

    _inside(col, row, maxCol = CONFIG.MATRIX.COLS - 1, maxRow = CONFIG.MATRIX.ROWS - 1) {
        return col >= 0 && col <= maxCol && row >= 0 && row <= maxRow;
    }

    // =========================================================================
    // isOverlapping — 检查本线是否与任何其他线共享格点（委托给 DotMatrix）
    // =========================================================================
    isOverlapping() {
        const seen = new Set();
        for (const step of this.steps) {
            seen.add(`${step.startCol},${step.startRow}`);
            seen.add(`${step.endCol},${step.endRow}`);
        }
        for (const key of seen) {
            const [c, r] = key.split(',').map(Number);
            const o = this.dotMatrix.getOccupant(c, r);
            if (o && o !== this) return o;
        }
        return null;
    }

    // =========================================================================
    // _makeLabel
    // =========================================================================
    _makeLabel(toX, toY) {
        const head = this.steps[0];
        const px = toX((head.startCol + head.endCol) / 2);
        const py = toY((head.startRow + head.endRow) / 2);
        this._labelImg = this.scene.add.text(px, py, this.label, {
            fontSize: '14px',
            color: '#ff4444',
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold',
            stroke: '#ffffff',
            strokeThickness: 2,
        }).setOrigin(0.5).setDepth(10);
        this.container.add(this._labelImg);
    }

    // =========================================================================
    // _dispose — 飞出后彻底清理
    // =========================================================================
    _dispose() {
        // 释放所有格点
        for (const step of this.steps) {
            this.dotMatrix.release(step.startCol, step.startRow, this);
            this.dotMatrix.release(step.endCol, step.endRow, this);
        }
        if (this._labelImg) { this._labelImg.destroy(); this._labelImg = null; }
        this.images.forEach(img => img.destroy());
        this.images = [];
        this.steps = [];
        ArrowLine._all = ArrowLine._all.filter(l => l !== this);
    }
}
