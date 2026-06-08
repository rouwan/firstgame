/**
 * ArrowLineNew — 箭头线游戏对象（按需求文档重写）
 *
 * 【定义】箭头线 = 尾巴点 + 路径
 * 【当前实现范围】数据模型 + 绘制（含步对象 + 标签），其他功能待整理
 */

// =========================================================================
// Step — 步对象（点阵上的最小单元：一条有向边）
// =========================================================================
class Step {

    /**
     * @param {number} startCol - 起点列
     * @param {number} startRow - 起点行
     * @param {number} endCol   - 终点列
     * @param {number} endRow   - 终点行
     * @param {string} dir      - 方向 'right'|'down'|'left'|'up'
     * @param {boolean} isLast  - 是否最后一个有向向量的最后一步（决定纹理类型）
     * @param {Object} DIR      - 方向→角度映射
     */
    constructor(startCol, startRow, endCol, endRow, dir, isLast, DIR) {
        // ---- 两个端点 ----
        this.startCol = startCol;
        this.startRow = startRow;
        this.endCol   = endCol;
        this.endRow   = endRow;

        // ---- 方向 + 角度 ----
        this.dir   = dir;
        this.angle = DIR[dir].angle;

        // ---- 纹理类型 ----
        this.texture = isLast ? 'arrow' : 'segment';

        // ---- 无向边 key（碰撞检测用） ----
        this.edgeKey = Step.makeEdgeKey(startCol, startRow, endCol, endRow);
    }

    /** 中心点：两个端点的中点（格子坐标） */
    get centerCol() { return (this.startCol + this.endCol) / 2; }
    get centerRow() { return (this.startRow + this.endRow) / 2; }

    /** 生成无向边的唯一 key（端点排序，AB 和 BA 视为同一条） */
    static makeEdgeKey(c1, r1, c2, r2) {
        if (c1 < c2 || (c1 === c2 && r1 < r2)) {
            return `${c1},${r1}-${c2},${r2}`;
        }
        return `${c2},${r2}-${c1},${r1}`;
    }
}

// =========================================================================
// ArrowLineNew — 箭头线（数据模型 + 绘制）
// =========================================================================
class ArrowLineNew {

    static DEV = true;        // 开发模式：显示标签
    static _all = [];         // 全局注册表：所有实例

    /**
     * @param {Phaser.Scene} scene
     * @param {Phaser.Container} container
     * @param {number} tailCol   - 尾巴点列
     * @param {number} tailRow   - 尾巴点行
     * @param {Array}  path      - 路径 [{dir, count}, ...]
     * @param {Function} toX     - 格列→容器像素 X
     * @param {Function} toY     - 格行→容器像素 Y
     * @param {Object} DIR       - 方向→角度映射
     * @param {string} label     - 开发标签文字
     */
    constructor(scene, container, tailCol, tailRow, path, toX, toY, DIR, label = '') {
        this.scene = scene;
        this.container = container;

        // ======== 核心数据 ========
        this.tailCol = tailCol;
        this.tailRow = tailRow;
        this.path    = path;
        this.label   = label;

        // ======== ① 展开：路径 → 步序列 → Step 对象 ========
        this.steps = this._expand(tailCol, tailRow, path, DIR);

        // ======== 头尖点 = 最后一步的终点 ========
        const lastStep = this.steps[this.steps.length - 1];
        this.headCol = lastStep.endCol;
        this.headRow = lastStep.endRow;

        // ======== ②~⑦ 逐步绘制 ========
        this._buildImages(toX, toY);

        // ======== ⑨ 标签 ========
        if (ArrowLineNew.DEV && label) {
            this._makeLabel(toX, toY);
        }

        // ======== 注册到全局 ========
        ArrowLineNew._all.push(this);
    }

    // =========================================================================
    // _expand — ① 路径 → 步序列 → Step 对象数组
    // =========================================================================
    _expand(tailCol, tailRow, path, DIR) {
        const steps = [];
        let col = tailCol;
        let row = tailRow;

        // 遍历所有有向向量
        for (let vi = 0; vi < path.length; vi++) {
            const vec = path[vi];                              // 有向向量
            const isLastVector = (vi === path.length - 1);     // 最后一个有向向量？
            const d = DIR[vec.dir];

            // 一个有向向量 = count 个步
            for (let si = 0; si < vec.count; si++) {
                const nextCol = col + d.dx;
                const nextRow = row + d.dy;
                const isLastStep = isLastVector && (si === vec.count - 1);

                steps.push(new Step(col, row, nextCol, nextRow, vec.dir, isLastStep, DIR));

                col = nextCol;
                row = nextRow;
            }
        }

        return steps;    // [步0, 步1, ..., 步N-1]，最后一步是头
    }

    // =========================================================================
    // _buildImages — ②~⑦ 逐步定边→定纹理→定中心→转像素→定角度→创建→排序
    // =========================================================================
    _buildImages(toX, toY) {
        this.images = [];

        // 遍历步序列 → ②③④⑤⑥⑦
        for (const step of this.steps) {
            const px = toX(step.centerCol);      // ④ 中心 → ⑤ 像素
            const py = toY(step.centerRow);

            const img = this.scene.add.image(px, py, step.texture)   // ⑦ 创建
                .setAngle(step.angle);                                // ⑥ 角度

            this.container.add(img);
            this.images.push(img);
        }

        // ⑧ 排序：反转 → images[0]=头, images[N-1]=尾
        this.images.reverse();
    }

    // =========================================================================
    // isInside — 所有步的端点是否严格在点阵格子内？
    //   判定粒度：严格 — 每个步的起点和终点都在 [0,COLS-1] × [0,ROWS-1]
    //   返回 true / false，具体处理由调用方决定
    // =========================================================================
    isInside() {
        const maxCol = CONFIG.MATRIX.COLS - 1;
        const maxRow = CONFIG.MATRIX.ROWS - 1;

        for (const step of this.steps) {
            if (step.startCol < 0 || step.startCol > maxCol) return false;
            if (step.startRow < 0 || step.startRow > maxRow) return false;
            if (step.endCol   < 0 || step.endCol   > maxCol) return false;
            if (step.endRow   < 0 || step.endRow   > maxRow) return false;
        }

        return true;
    }

    // =========================================================================
    // isOverlapping — 是否与全局中其他箭头线重合？
    //   判定粒度：共享一个格点即算重合
    //   返回 true / false
    // =========================================================================
    isOverlapping() {
        // 收集自己的所有格点
        const myPoints = new Set();
        for (const step of this.steps) {
            myPoints.add(`${step.startCol},${step.startRow}`);
            myPoints.add(`${step.endCol},${step.endRow}`);
        }

        // 与全局其他线逐点比对
        for (const other of ArrowLineNew._all) {
            if (other === this) continue;
            for (const step of other.steps) {
                if (myPoints.has(`${step.startCol},${step.startRow}`)) return true;
                if (myPoints.has(`${step.endCol},${step.endRow}`))     return true;
            }
        }

        return false;
    }

    // =========================================================================
    // _makeLabel — ⑨ 头尖点上贴开发标签
    // =========================================================================
    _makeLabel(toX, toY) {
        const px = toX(this.headCol);
        const py = toY(this.headRow);

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
}
