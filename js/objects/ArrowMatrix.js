/**
 * ArrowMatrix — 箭头阵
 *
 * 管理点阵 + 所有箭头线。当前功能：生成全覆盖箭头线。
 */

class ArrowMatrix {

    /**
     * @param {Phaser.Scene} scene
     * @param {number} cols    - 列数
     * @param {number} rows    - 行数
     * @param {number} spacing - 点间距
     */
    constructor(scene, cols, rows, spacing) {
        this.scene = scene;
        this.cols = cols;
        this.rows = rows;
        this.spacing = spacing;
        this.lines = [];         // ArrowLine[]
        this.container = scene.add.container(0, 0);

        // 点阵：格点占用管理（唯一真相源）
        this.dotMatrix = new DotMatrix(scene, cols, rows, spacing);

        // 坐标映射（复用 DotMatrix 的，也暴露给 ArrowLine 渲染用）
        this.toX = this.dotMatrix.toX;
        this.toY = this.dotMatrix.toY;

        // 方向映射
        this.DIR = {
            right: { dx: 1, dy: 0, angle: 0   },
            down:  { dx: 0, dy: 1, angle: 90  },
            left:  { dx: -1, dy: 0, angle: 180 },
            up:    { dx: 0, dy: -1, angle: -90 },
        };
    }

    // =========================================================================
    // 绘制点阵
    // =========================================================================
    drawDots() {
        this.dotMatrix.draw(this.container);
    }

    // =========================================================================
    // 横扫生成：每行一条右向箭头线，覆盖所有点
    // =========================================================================
    sweepFill() {
        this.lines = [];
        for (let row = 0; row < this.rows; row++) {
            const line = new ArrowLine(
                this.scene, this.container,
                this.dotMatrix,
                0, row,                              // 尾巴点：每行最左
                [{ dir: 'right', count: this.cols - 1 }],  // 右向横扫
                this.toX, this.toY, this.DIR,
                `${row}`                             // 标签 = 行号
            );
            this.lines.push(line);
        }
    }

    // =========================================================================
    // 分区填充 — 区块 + DAG 依赖
    // =========================================================================

    /**
     * regionFill — 按区块分区 → 每个区块蛇形填充 → 飞向指向邻区形成 DAG 依赖
     *
     * 内部三步：
     *   ① 把网格随机切为若干垂直区块
     *   ② 分配 flyDir：每个区块的方向要么安全（飞离棋盘），要么指向相邻区块
     *      规则保证依赖图是 DAG，避免死锁
     *   ③ 每个区块生成一条蛇形路径 → 压缩为 path → 创建 ArrowLine
     *
     * @param {object} opts
     * @param {number} opts.numRegions - 区块数（默认 3）
     * @param {number} opts.seed       - 随机种子（默认 0 = 不固定）
     */
    regionFill(opts = {}) {
        const numRegions = opts.numRegions || 3;

        // ① 随机分区：至少 2 列才能分区，否则退化为横扫
        if (this.cols < numRegions) {
            this.sweepFill();
            return;
        }
        const partitions = this._randomPartition(numRegions);

        // ② 分配 flyDir：构建 DAG
        const flyDirs = this._assignFlyDirs(partitions);

        // ③ 每个区块生成路径 → 创建 ArrowLine
        this.lines = [];
        for (let ri = 0; ri < partitions.length; ri++) {
            const [cStart, cEnd] = partitions[ri];
            const flyDir = flyDirs[ri];
            const steps = this._stripSnakePath(cStart, cEnd, 0, this.rows - 1, flyDir);
            if (steps.length === 0) continue;

            const path = this._compressPath(steps);
            const line = new ArrowLine(
                this.scene, this.container,
                this.dotMatrix,
                steps[0].startCol, steps[0].startRow, path,
                this.toX, this.toY, this.DIR,
                String(ri)
            );
            this.lines.push(line);
        }
    }

    // =========================================================================
    // _randomPartition — 把 cols 列随机切为 n 个连续区间，每个区间宽度 ≥ 1
    // =========================================================================
    _randomPartition(n) {
        // 在 [1, cols-1] 中随机取 n-1 个切点
        const pool = [];
        for (let c = 1; c < this.cols; c++) pool.push(c);
        for (let i = 0; i < n - 1 && i < pool.length; i++) {
            const j = i + Math.floor(Math.random() * (pool.length - i));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const cuts = pool.slice(0, n - 1);
        cuts.sort((a, b) => a - b);
        cuts.unshift(0);
        cuts.push(this.cols);

        const partitions = [];
        for (let i = 0; i < cuts.length - 1; i++) {
            partitions.push([cuts[i], cuts[i + 1] - 1]);
        }
        return partitions;
    }

    // =========================================================================
    // _assignFlyDirs — 为每个区块分配飞向，保证依赖图是无环的（DAG）
    //
    // 规则：
    //   - 每个区块分配一个"依赖等级" level ∈ {0, 1, 2}
    //   - level=0 的区块飞向棋盘外（上行/下行）→ 安全，无依赖
    //   - level>0 的区块飞向相邻的 level-1 区块
    //
    // 结果：依赖图是一棵或多棵树，解法不唯一但也不完全自由
    //
    // 例如 (5列, 4区块, 等级 [0,1,2,0])：
    //   区块0 (level 0): flyDir=up    安全
    //   区块1 (level 1): flyDir=left  指向区块0 → 依赖区块0先飞
    //   区块2 (level 2): flyDir=left  指向区块1 → 依赖区块1先飞（及区块0）
    //   区块3 (level 0): flyDir=down  安全
    //
    //   合法解：0→1→2→3, 0→3→1→2, 3→0→1→2, ...
    // =========================================================================
    _assignFlyDirs(partitions) {
        const n = partitions.length;

        // 随机为每个区块分配 level
        const levels = partitions.map(() => Math.floor(Math.random() * 3));  // 0, 1, 2

        // 边上的区块 level=0 时往棋盘外飞（安全方向）
        //   最左区块 flyDir=left → 飞出左边界
        //   最右区块 flyDir=right → 飞出右边界
        const flyDirs = [];

        for (let i = 0; i < n; i++) {
            if (levels[i] === 0) {
                // 安全区块：飞离棋盘
                if (i === 0) {
                    flyDirs[i] = 'left';   // 最左 → 离场
                } else if (i === n - 1) {
                    flyDirs[i] = 'right';  // 最右 → 离场
                } else {
                    // 中间的安全区块也会飞向某个邻居，但我们让它飞向棋盘外（上方或下方）
                    flyDirs[i] = Math.random() < 0.5 ? 'up' : 'down';
                }
            } else {
                // 非安全区块：飞向相邻的 level-1 区块（如果存在）
                // 先找左边或右边有没有 level-1
                const targets = [];
                if (i > 0 && levels[i - 1] < levels[i]) targets.push('left');
                if (i < n - 1 && levels[i + 1] < levels[i]) targets.push('right');
                if (targets.length > 0) {
                    flyDirs[i] = targets[Math.floor(Math.random() * targets.length)];
                } else {
                    // 没有 level-1 邻居：降级为安全方向
                    flyDirs[i] = Math.random() < 0.5 ? 'up' : 'down';
                }
            }
        }

        return flyDirs;
    }

    // =========================================================================
    // _stripSnakePath — 在矩形区域 [cStart,cEnd]×[rStart,rEnd] 内蛇形填充
    //
    // 蛇形规律：第一行右走 → 下行连接 → 第二行左走 → 下行连接 → ...
    // flyDir 决定最后一步的方向（即线的飞行方向）
    //
    // 当 flyDir 为 up/down 时（单列或安全方向），会在末端添加一个垂直步
    // =========================================================================
    _stripSnakePath(cStart, cEnd, rStart, rEnd, flyDir) {
        const steps = [];
        const height = rEnd - rStart + 1;
        const width  = cEnd - cStart + 1;

        if (height <= 0 || width <= 0) return steps;

        // 遍历每行
        for (let ri = 0; ri < height; ri++) {
            const row = rStart + ri;
            const goRight = (ri % 2 === 0);

            if (width > 1) {
                if (goRight) {
                    for (let c = cStart; c < cEnd; c++) {
                        steps.push({ startCol: c, startRow: row, endCol: c + 1, endRow: row, dir: 'right' });
                    }
                } else {
                    for (let c = cEnd; c > cStart; c--) {
                        steps.push({ startCol: c, startRow: row, endCol: c - 1, endRow: row, dir: 'left' });
                    }
                }
            }
            // 行间垂直连接
            if (ri < height - 1) {
                const col = goRight ? cEnd : cStart;
                steps.push({ startCol: col, startRow: row, endCol: col, endRow: row + 1, dir: 'down' });
            }
        }

        if (steps.length === 0) return steps;

        // 如果最后一步的方向恰好是 flyDir，完美
        if (steps[steps.length - 1].dir === flyDir) return steps;

        // 如果需要的 flyDir 是 up/down/left/right 之一，调整最后一步
        //   策略：在路径末尾追加一个转向步，方向 = flyDir
        //   该步的终点可能落在邻区甚至棋盘外——这正是依赖关系的来源
        const last = steps[steps.length - 1];
        const newStartCol = last.endCol;
        const newStartRow = last.endRow;
        let dCol = 0, dRow = 0;
        switch (flyDir) {
            case 'right': dCol = 1; break;
            case 'left':  dCol = -1; break;
            case 'down':  dRow = 1; break;
            case 'up':    dRow = -1; break;
            default: return steps;
        }
        const newEndCol = newStartCol + dCol;
        const newEndRow = newStartRow + dRow;

        // 总是追加（终点可能在邻区，甚至在棋盘外——这正是依赖的来源）
        // 格点占用由 DotMatrix 管理，终点不属于本线领地则在 _registerPoints 跳过
        steps.push({ startCol: newStartCol, startRow: newStartRow, endCol: newEndCol, endRow: newEndRow, dir: flyDir });

        return steps;
    }

    // =========================================================================
    // _compressPath — 步序列 → [{dir, count}, ...]（ArrowLine 构造函数的 path 格式）
    //
    // 示例:
    //   [right, right, right, down, down] → [{dir:'right', count:3}, {dir:'down', count:2}]
    // =========================================================================
    _compressPath(steps) {
        if (steps.length === 0) return [];
        const path = [];
        let curDir = steps[0].dir;
        let count = 1;
        for (let i = 1; i < steps.length; i++) {
            if (steps[i].dir === curDir) {
                count++;
            } else {
                path.push({ dir: curDir, count });
                curDir = steps[i].dir;
                count = 1;
            }
        }
        path.push({ dir: curDir, count });
        return path;
    }

    // =========================================================================
    // 居中定位
    // =========================================================================
    setPosition(x, y) {
        this.container.setPosition(x, y);
    }
}
