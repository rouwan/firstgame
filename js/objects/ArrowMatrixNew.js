/**
 * ArrowMatrixNew — 箭头阵（新版）
 *
 * 管理点阵 + 所有箭头线。生成方式从模板改为随机游走。
 *
 * 核心方法：
 *   generateOneLine() — 每次调用从点阵可用点出发，随机游走生成一条箭头线
 */

class ArrowMatrixNew {

    /**
     * @param {Phaser.Scene} scene
     * @param {number} cols
     * @param {number} rows
     * @param {number} spacing
     */
    constructor(scene, cols, rows, spacing) {
        this.scene = scene;
        this.cols = cols;
        this.rows = rows;
        this.spacing = spacing;
        this.lines = [];         // ArrowLine[]
        this.container = scene.add.container(0, 0);

        // 点阵：格点占用管理（唯一真相源）
        this.dotMatrix = new DotMatrixNew(scene, cols, rows, spacing);

        // 坐标映射（复用 DotMatrix）
        this.toX = this.dotMatrix.toX;
        this.toY = this.dotMatrix.toY;

        // 方向映射
        this.DIR = {
            right: { dx: 1, dy: 0,  angle: 0   },
            down:  { dx: 0, dy: 1,  angle: 90  },
            left:  { dx: -1, dy: 0, angle: 180 },
            up:    { dx: 0, dy: -1, angle: -90 },
        };
    }

    // =========================================================================
    // 点阵绘制（委托）
    // =========================================================================
    drawDots() {
        this.dotMatrix.draw(this.container);
    }

    // =========================================================================
    // generateOneLine — 随机游走生成一条箭头线
    //
    // 算法：
    //   ① 从点阵随机取一个空闲点 P0
    //   ② 在 P0 四方向找空闲邻居 → 随机选 P1 → 创建第一个步
    //   ③ 循环：从当前点找空闲邻居 + 终止 → 等权随机选
    //      - 选邻居 → 占点 → 加步 → 继续
    //      - 选终止 → 结束，最后一个步的终点成为箭头尖
    //   ④ 压缩步序列为 path → 创建 ArrowLine
    //
    // @returns {ArrowLine|null} 成功返回线，失败返回 null
    // =========================================================================
    generateOneLine() {
        const line = this._tryGenerateOneLine();
        if (!line) return null;

        // 回环检查：箭头前方到棋盘边界的整条射线上不能有自己
        if (this._isLoop(line)) {
            line._dispose();
            if (ArrowLine.DEV) console.log('[ArrowMatrixNew] Loop detected, discarded');
            return null;
        }

        this.lines.push(line);

        if (ArrowLine.DEV) {
            console.log(
                `[ArrowMatrixNew] Line ${this.lines.length - 1}: ` +
                `flyDir=${line.flyDir}, head=(${line.headCol},${line.headRow})`
            );
        }
        return line;
    }

    // =========================================================================
    // generateAll — 循环生成直到结束
    //
    // @param {function} onProgress — 每生成一条回调 (line, count)
    // @returns {number} 总共生成的线数
    // =========================================================================
    generateAll(onProgress) {
        let count = 0;
        let failStreak = 0;
        while (true) {
            const line = this.generateOneLine();
            if (line) {
                count++;
                failStreak = 0;
                if (onProgress) onProgress(line, count);
            } else if (this.isDone()) {
                break;  // 无点/孤点 → 真正结束
            } else {
                failStreak++;
                if (failStreak >= 50) break;  // 安全阀：连续失败太多，放弃
            }
        }
        return count;
    }

    // =========================================================================
    // _tryGenerateOneLine — 单次尝试：随机游走生成步骤序列 → 创建 ArrowLine
    // =========================================================================
    _tryGenerateOneLine() {
        // ① 随机起点
        const p0 = this.dotMatrix.getRandomAvailablePoint();
        if (!p0) {
            if (ArrowLine.DEV) console.log('[ArrowMatrixNew] No available points');
            return null;
        }

        // ② 找第一个邻居
        const n0 = this.dotMatrix.getAvailableNeighbors(p0.col, p0.row);
        if (n0.length === 0) {
            if (ArrowLine.DEV) console.log(`[ArrowMatrixNew] Isolated point (${p0.col},${p0.row}), skip`);
            return null;
        }
        const p1 = n0[Math.floor(Math.random() * n0.length)];

        // ③ 本地追踪本轮用了哪些点（构造阶段不向 dotMatrix 实际占用，
        //    等 ArrowLine 构造函数中 _registerPoints 统一占用）
        const used = new Set();
        used.add(`${p0.col},${p0.row}`);
        used.add(`${p1.col},${p1.row}`);

        const steps = [{
            startCol: p0.col, startRow: p0.row,
            endCol:   p1.col, endRow:   p1.row,
            dir:      p1.dir,
        }];

        // ④ 循环扩展
        let current = { col: p1.col, row: p1.row };
        const terminateProb = CONFIG.ARROW_MATRIX.TERMINATE_PROB;

        while (true) {
            // 可用邻居 = 点阵空闲 + 本轮未用
            const neighbors = this.dotMatrix
                .getAvailableNeighbors(current.col, current.row)
                .filter(n => !used.has(`${n.col},${n.row}`));

            if (neighbors.length === 0) break;  // 无邻居 → 必须终止

            if (Math.random() < terminateProb) break;  // 抽中终止

            const next = neighbors[Math.floor(Math.random() * neighbors.length)];
            used.add(`${next.col},${next.row}`);
            steps.push({
                startCol: current.col, startRow: current.row,
                endCol:   next.col,    endRow:   next.row,
                dir:      next.dir,
            });
            current = next;
        }

        // ⑤ 压缩 → path 格式
        const path = this._compressPath(steps);
        if (path.length === 0) return null;

        // ⑥ 创建 ArrowLine
        const line = new ArrowLine(
            this.scene, this.container, this.dotMatrix,
            steps[0].startCol, steps[0].startRow,
            path,
            this.toX, this.toY, this.DIR,
            String(this.lines.length)
        );

        // 补注册箭头尖端（_registerPoints 跳过它）
        if (line.steps.length > 0) {
            const tip = line.steps[0];
            this.dotMatrix.occupy(tip.endCol, tip.endRow, line);
        }

        return line;
    }

    // =========================================================================
    // _isLoop — 从箭头尖端沿 flyDir 直射到棋盘边，检查是否有自己
    // =========================================================================
    _isLoop(line) {
        if (line.steps.length === 0) return false;
        const d = DIR_MAP[line.flyDir];
        let c = line.headCol + d.dx;
        let r = line.headRow + d.dy;
        while (this.dotMatrix.inside(c, r)) {
            if (this.dotMatrix.getOccupant(c, r) === line) return true;
            c += d.dx;
            r += d.dy;
        }
        return false;
    }

    // =========================================================================
    // _compressPath — 步序列 → [{dir, count}, ...]
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
    // 是否生成结束（无可用点 或 只剩孤点）
    // =========================================================================
    isDone() {
        const available = this.dotMatrix.getAvailablePoints();
        if (available.length === 0) return true;  // 满了
        // 检查是否所有可用点都是孤点
        for (const p of available) {
            const neighbors = this.dotMatrix.getAvailableNeighbors(p.col, p.row);
            if (neighbors.length > 0) return false;  // 还有可用的起点
        }
        return true;  // 全是孤点
    }

    // =========================================================================
    // 居中定位
    // =========================================================================
    setPosition(x, y) {
        this.container.setPosition(x, y);
    }
}
