/**
 * ArrowLineNew — 箭头线游戏对象（按需求文档重写）
 *
 * 【定义】箭头线 = 尾巴点 + 路径 → Step 对象数组
 * 【当前实现】数据模型 + 绘制 + 前进
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
const DIR_MAP_NEW = {
    right: { dx: 1, dy: 0 },
    down:  { dx: 0, dy: 1 },
    left:  { dx: -1, dy: 0 },
    up:    { dx: 0, dy: -1 },
};

// =========================================================================
// ArrowLineNew — 箭头线
// =========================================================================
class ArrowLineNew {

    static DEV = true;
    static _all = [];

    constructor(scene, container, tailCol, tailRow, path, toX, toY, DIR, label = '') {
        this.scene = scene;
        this.container = container;

        // ======== 核心数据 ========
        this.tailCol = tailCol;
        this.tailRow = tailRow;
        this.path    = path;
        this.label   = label;

        // ======== 保存坐标映射（前进/绘制用） ========
        this._toX = toX;
        this._toY = toY;
        this._DIR = DIR;

        // ======== ① 展开：路径 → Step[] ========
        this.steps = this._expand(tailCol, tailRow, path, DIR);

        // ======== 头尖点 + 飞行方向 ========
        this.headCol = this.steps[0].endCol;
        this.headRow = this.steps[0].endRow;
        this.flyDir  = this.steps[0].dir;

        // ======== ②~⑦ 绘制 ========
        this._buildImages(toX, toY);

        // ======== ⑨ 标签 ========
        if (ArrowLineNew.DEV && label) this._makeLabel(toX, toY);

        // ======== 注册 ========
        ArrowLineNew._all.push(this);
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
    // _buildImages
    // =========================================================================
    _buildImages(toX, toY) {
        this.images = [];
        for (const step of this.steps) {
            const img = this.scene.add.image(toX(step.centerCol), toY(step.centerRow), step.texture)
                .setAngle(step.angle)
                .setInteractive({ useHandCursor: true });
            // 触发方式由外部控制（按钮/点击/关卡信号等），参见 advance() / retreat()
            this.container.add(img);
            this.images.push(img);
        }
        // images 顺序和 steps 一致：[0]=头, [N-1]=尾
    }

    // =========================================================================
    // advance — 前进（两阶段算法：移动 + 标箭头）
    // =========================================================================
    advance() {
        if (this._moving) return;
        this._moving = true;

        const d = DIR_MAP_NEW[this.flyDir];
        const stepMs = CONFIG.ARROW_LINE.STEP_DURATION;

        const tick = () => {
            if (this.steps.length === 0) return;

            // ===== ① 移动 =====
            const oldHead = this.steps[0];
            const newEndCol = oldHead.endCol + d.dx;
            const newEndRow = oldHead.endRow + d.dy;
            const newHead = new Step(
                oldHead.endCol, oldHead.endRow,
                newEndCol, newEndRow,
                this.flyDir, true, this._DIR
            );

            this.steps.pop();           // 去尾
            this.steps.unshift(newHead); // 加头
            this.headCol = newEndCol;
            this.headRow = newEndRow;

            // ===== ② 标箭头 =====
            this.steps[0].texture = 'arrow';
            for (let i = 1; i < this.steps.length; i++) {
                this.steps[i].texture = 'segment';
            }

            // ===== 重绘 =====
            this.images.forEach(img => img.destroy());
            this.images = [];
            this._buildImages(this._toX, this._toY);
            if (this._labelImg) { this._labelImg.destroy(); this._labelImg = null; }
            if (ArrowLineNew.DEV && this.label) this._makeLabel(this._toX, this._toY);

            // ===== 碰撞检测 → 委托给响应方法 =====
            const blocker = this.isOverlapping();
            if (blocker) {
                this._onOverlap(blocker);
                return;
            }

            // ===== 结束条件：尾离开点阵 =====
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
    // _onOverlap — 碰撞响应（临时：停止。后续扩展为变红/复位等）
    // =========================================================================
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
    // _retreat — 后退到目标点（内部循环）
    // =========================================================================
    _retreat(targetCol, targetRow) {
        const stepMs = CONFIG.ARROW_LINE.STEP_DURATION;

        const tick = () => {
            if (this.steps.length === 0) return;

            const tail = this.steps[this.steps.length - 1];
            if (tail.startCol === targetCol && tail.startRow === targetRow) return;
            if (this.steps.length === 0) return;

            // ① 去头，加新尾（沿尾巴走线反向延伸）
            const d = DIR_MAP_NEW[tail.dir];
            const newTail = new Step(
                tail.startCol - d.dx, tail.startRow - d.dy,
                tail.startCol, tail.startRow,
                tail.dir, false, this._DIR
            );

            this.steps.shift();                    // 去头
            this.steps.push(newTail);              // 加新尾
            this.tailCol = newTail.startCol;       // 更新尾巴点
            this.tailRow = newTail.startRow;

            // ② 标箭头
            this.steps[0].texture = 'arrow';
            for (let i = 1; i < this.steps.length; i++) this.steps[i].texture = 'segment';

            // 更新头尖点
            this.headCol = this.steps[0].endCol;
            this.headRow = this.steps[0].endRow;

            // 重绘 + 保持红
            this.images.forEach(img => img.destroy());
            this.images = [];
            this._buildImages(this._toX, this._toY);
            if (this._labelImg) { this._labelImg.destroy(); this._labelImg = null; }
            if (ArrowLineNew.DEV && this.label) this._makeLabel(this._toX, this._toY);
            this.images.forEach(img => img.setTintFill(0xff4444));

            this.scene.time.delayedCall(stepMs, tick);
        };

        tick();
    }

    // =========================================================================
    // _onHit — 被别人撞的响应（临时：变红。后续完善）
    // =========================================================================
    _onHit() {
        // 瞬间变红 → 保持 → 渐变回原色
        this.images.forEach(img => img.setTintFill(0xff4444));

        const holdMs = 300;   // 保持时间：纯红多久
        const fadeMs = 1000;  // 渐变时间：红→原色多久

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
    // isOverlapping — 返回重合的对方引用，无重合返回 null
    // =========================================================================
    isOverlapping() {
        const myPoints = new Set();
        for (const step of this.steps) {
            myPoints.add(`${step.startCol},${step.startRow}`);
            myPoints.add(`${step.endCol},${step.endRow}`);
        }
        for (const other of ArrowLineNew._all) {
            if (other === this) continue;
            for (const step of other.steps) {
                if (myPoints.has(`${step.startCol},${step.startRow}`)) return other;
                if (myPoints.has(`${step.endCol},${step.endRow}`))     return other;
            }
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
        if (this._labelImg) { this._labelImg.destroy(); this._labelImg = null; }
        this.images.forEach(img => img.destroy());
        this.images = [];
        this.steps = [];
        ArrowLineNew._all = ArrowLineNew._all.filter(l => l !== this);
    }
}
