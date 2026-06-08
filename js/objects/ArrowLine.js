/**
 * ArrowLine — 箭头线游戏对象
 *
 * 【定义】箭头线 = 尾巴点 + 路径（N 个有向向量）
 *   尾巴点  — startCol, startRow，路径第一个有向向量的出发点
 *   路径    — [{dir, count}, ...]，每个有向向量朝一个方向连走 count 格
 *   有向向量 — 朝一个方向连走直到转弯的一段
 *   头尖点  — 路径末端，即箭头尖端，可由 尾巴点+路径 算出
 *
 * 【序号】images[0]=头(箭头), images[N-1]=尾(线段)
 *
 * 【行为】
 *   点击 → 贪吃蛇式逐格飞出（毁建，非移动）
 *   飞行中头撞到另一条线 → 自己永久红 + 弹回尾巴点，对方闪烁 0.5s 恢复
 */

// 方向 → 位移分量
const DIR_MAP = {
    right: { dx: 1, dy: 0 },
    down:  { dx: 0, dy: 1 },
    left:  { dx: -1, dy: 0 },
    up:    { dx: 0, dy: -1 },
};

// 无向边的唯一 key（端点排序，AB 和 BA 视为同一条边）
function edgeKey(c1, r1, c2, r2) {
    if (c1 < c2 || (c1 === c2 && r1 < r2)) {
        return `${c1},${r1}-${c2},${r2}`;
    }
    return `${c2},${r2}-${c1},${r1}`;
}

class ArrowLine {

    // 全局边注册表：key → 占据该边的 ArrowLine
    static _edgeMap = new Map();

    // 开发模式：true 显示标签，false 隐藏
    static DEV = true;

    constructor(scene, container, startCol, startRow, path, toX, toY, DIR, label = '') {
        this.scene = scene;
        this.container = container;
        this.images = [];       // [0]=头(箭头), [1..n-1]=身体(线段)
        this.alive = true;
        this._flying = false;  // 飞行中？用于禁用点击
        this._label = label;

        // ---- 初始记录（尾巴点 + 路径 + 坐标映射），复位用 ----
        this._startCol = startCol;
        this._startRow = startRow;
        this._path = path;
        this._toX = toX;
        this._toY = toY;
        this._DIR = DIR;

        // 路径展开为逐步方向数组
        this._steps = [];
        for (const seg of path) {
            for (let i = 0; i < seg.count; i++) {
                this._steps.push(seg.dir);
            }
        }
        this.flyDir = this._steps[this._steps.length - 1];

        // 绘制
        this._buildImages(toX, toY, DIR);

        // 开发标签
        if (ArrowLine.DEV && label) {
            this._makeLabel();
        }
    }

    // =========================================================================
    // _buildImages — 根据 steps 创建图像 + 注册边（constructor / _reset 共用）
    // =========================================================================
    _buildImages(toX, toY, DIR) {
        let col = this._startCol;
        let row = this._startRow;
        this._edges = [];

        for (let i = 0; i < this._steps.length; i++) {
            const d = DIR[this._steps[i]];
            const nextCol = col + d.dx;
            const nextRow = row + d.dy;
            const isLast = (i === this._steps.length - 1);
            const tex = isLast ? 'arrow' : 'segment';

            const cx = (col + nextCol) / 2;
            const cy = (row + nextRow) / 2;

            const img = this.scene.add.image(toX(cx), toY(cy), tex)
                .setAngle(d.angle)
                .setInteractive({ useHandCursor: true });

            img.on('pointerdown', () => this.fly());
            this.container.add(img);
            this.images.push(img);

            const key = edgeKey(col, row, nextCol, nextRow);
            this._edges.push(key);
            ArrowLine._edgeMap.set(key, this);

            col = nextCol;
            row = nextRow;
        }

        this.headCol = col;
        this.headRow = row;
        this.images.reverse();  // [0] = 头
    }

    // =========================================================================
    // fly — 逐格飞出，带碰撞检测
    // =========================================================================
    fly() {
        if (!this.alive || this._flying) return;
        this._flying = true;

        const d = DIR_MAP[this.flyDir];
        const stepDist = CONFIG.MATRIX.SPACING;
        const stepMs = CONFIG.ARROW_LINE.STEP_DURATION;
        const cx = this.container.x;
        const cy = this.container.y;

        const tick = () => {
            if (this.images.length === 0) return;

            // ---- 碰撞检测：头的下一格边是否被占？ ----
            const nextCol = this.headCol + d.dx;
            const nextRow = this.headRow + d.dy;
            const nextKey = edgeKey(this.headCol, this.headRow, nextCol, nextRow);
            const owner = ArrowLine._edgeMap.get(nextKey);

            if (owner && owner !== this && owner.images.length > 0) {
                this._onCollision(owner);
                return;
            }

            // ---- 更新边注册表：去尾、加头 ----
            const oldTailKey = this._edges.shift();
            ArrowLine._edgeMap.delete(oldTailKey);
            this._edges.push(nextKey);
            ArrowLine._edgeMap.set(nextKey, this);
            this.headCol = nextCol;
            this.headRow = nextRow;

            // ---- 快照 → 销毁 → 重生 ----
            const old = this.images.map(img => ({
                x: img.x, y: img.y, angle: img.angle, texture: img.texture.key,
            }));

            this.images.forEach(img => img.destroy());
            this.images = [];

            const newHead = this.scene.add.image(
                old[0].x + stepDist * d.dx,
                old[0].y + stepDist * d.dy,
                old[0].texture
            ).setAngle(old[0].angle).setInteractive({ useHandCursor: true });
            newHead.on('pointerdown', () => this.fly());
            this.container.add(newHead);
            this.images.push(newHead);

            for (let i = 1; i < old.length; i++) {
                const prev = old[i - 1];
                const seg = this.scene.add.image(prev.x, prev.y, 'segment')
                    .setAngle(prev.angle)
                    .setInteractive({ useHandCursor: true });
                seg.on('pointerdown', () => this.fly());
                this.container.add(seg);
                this.images.push(seg);
            }

            // 标签跟随头
            if (this._labelImg) { this._labelImg.destroy(); this._labelImg = null; }
            if (ArrowLine.DEV && this._label) this._makeLabel();

            // ---- 尾巴离开屏幕 → 整线销毁 ----
            const tail = this.images[this.images.length - 1];
            const wx = tail.x + cx;
            const wy = tail.y + cy;

            if (wx < -50 || wx > CONFIG.GAME.WIDTH + 50 ||
                wy < -50 || wy > CONFIG.GAME.HEIGHT + 50) {
                this._dispose();
                return;
            }

            this.scene.time.delayedCall(stepMs, tick);
        };

        tick();
    }

    // =========================================================================
    // _onCollision — 撞到别的线：自己永久红 → 对方闪烁 → 自己弹回尾巴点
    // =========================================================================
    _onCollision(blocker) {
        // 自己：立刻变红，永久保持
        this.images.forEach(img => img.setTintFill(0xff4444));
        this.alive = false;  // 永久禁用点击

        // 被碰的：闪烁 0.5s 后恢复
        let visible = true;
        const blinkTimer = this.scene.time.addEvent({
            delay: 150,
            loop: true,
            callback: () => {
                visible = !visible;
                if (visible) {
                    blocker.images.forEach(img => img.setTintFill(0xff4444));
                } else {
                    blocker.images.forEach(img => img.clearTint());
                }
            },
        });

        this.scene.time.delayedCall(500, () => {
            blinkTimer.remove();
            blocker.images.forEach(img => img.clearTint());
        });

        // 0.8s 后复位位置（颜色保持红）
        this.scene.time.delayedCall(800, () => this._reset());
    }

    // =========================================================================
    // _reset — 弹回尾巴点，重建图像（红保持不变）
    // =========================================================================
    _reset() {
        // 注销旧边
        for (const key of this._edges) {
            ArrowLine._edgeMap.delete(key);
        }
        this._edges = [];

        // 销毁图像
        this.images.forEach(img => img.destroy());
        this.images = [];

        // 用 TO/X/Y/DIR 的初始值重建
        this._buildImages(this._toX, this._toY, this._DIR);

        // 标签 + 红晕（永久）
        if (ArrowLine.DEV && this._label) this._makeLabel();
        this.images.forEach(img => img.setTintFill(0xff4444));
        // _flying 保持 true，alive 保持 false，不再响应点击
    }

    // =========================================================================
    // _makeLabel — 在头位置打开发标签
    // =========================================================================
    _makeLabel() {
        const head = this.images[0];
        this._labelImg = this.scene.add.text(head.x, head.y - 8, this._label, {
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
    // _dispose — 飞出屏幕后彻底销毁
    // =========================================================================
    _dispose() {
        if (this._labelImg) { this._labelImg.destroy(); this._labelImg = null; }
        for (const key of this._edges) {
            ArrowLine._edgeMap.delete(key);
        }
        this.images.forEach(img => img.destroy());
        this.images = [];
    }
}
