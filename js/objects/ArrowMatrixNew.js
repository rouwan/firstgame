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
        this.order = [];         // 序列逆序构造：发射顺序（label 索引）
        this.orderIndex = 0;     // 当前发射到第几个
        this.batches = [];       // 生成批次统计 [{round, region, regionSize, count}]
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

        // ======== 日志引擎 ========
        this.eventLog = [];
        this.eventSeq = 0;
        this.generationStartTime = 0;
        this.initialSnapshot = null;
        this._stats = { clicks: 0, advances: 0, retreats: 0, collisions: 0, disposals: 0 };

        // ======== 分步生成状态 ========
        this._genState = 'idle';          // 'idle' | 'generating'
        this._genPass = 0;                // 当前轮次 1,2,3...
        this._genRegionIdx = 0;           // 当前区域内序号
        this._genAlreadyPlaced = null;    // Set of labels
    }

    // =========================================================================
    // 点阵绘制（委托）
    // =========================================================================
    drawDots() {
        this.dotMatrix.draw(this.container);
    }

    // =========================================================================
    // _tryGenerateLine — 随机游走 + flyDir 约束检查
    //
    // @param {Set} alreadyPlaced — 不能指向的线集合
    // @param {Set|null} boundarySet — 安全边界。null=物理边界（第1轮），
    //   非null=可安全指向的占据点集合（第2+轮，这些线将先飞走）
    // =========================================================================
    _tryGenerateLine(alreadyPlaced, boundarySet = null) {
        // ① 随机起点
        const p0 = this.dotMatrix.getRandomAvailablePoint();
        if (!p0) return null;

        // ② 找第一个邻居
        const n0 = this.dotMatrix.getAvailableNeighbors(p0.col, p0.row);
        if (n0.length === 0) return null;
        const p1 = n0[Math.floor(Math.random() * n0.length)];

        // ③ 本地追踪本轮用了哪些点
        const used = new Set();
        used.add(`${p0.col},${p0.row}`);
        used.add(`${p1.col},${p1.row}`);

        const localSteps = [{
            startCol: p0.col, startRow: p0.row,
            endCol:   p1.col, endRow:   p1.row,
            dir:      p1.dir,
        }];

        // ④ 循环扩展
        let current = { col: p1.col, row: p1.row };
        const terminateProb = CONFIG.ARROW_MATRIX.TERMINATE_PROB;

        while (true) {
            const neighbors = this.dotMatrix
                .getAvailableNeighbors(current.col, current.row)
                .filter(n => !used.has(`${n.col},${n.row}`));

            if (neighbors.length === 0) break;

            // 偏置终止：50% 概率尝试指向前序线
            const hasPredecessors = boundarySet && boundarySet.size > 0;
            const wantBias = hasPredecessors && Math.random() < (1 - CONFIG.ARROW_MATRIX.BOUNDARY_BIAS);

            if (Math.random() < terminateProb) {
                if (wantBias) {
                    // 找能指向前序线的邻居（head 紧挨 predecessor）
                    const predNeighbors = neighbors.filter(n => {
                        const nc0 = n.col + DIR_MAP[n.dir].dx;
                        const nr0 = n.row + DIR_MAP[n.dir].dy;
                        const occ = this.dotMatrix.getOccupant(nc0, nr0);
                        return occ && boundarySet.has(occ);
                    });
                    if (predNeighbors.length > 0) {
                        const next = predNeighbors[Math.floor(Math.random() * predNeighbors.length)];
                        used.add(`${next.col},${next.row}`);
                        localSteps.push({
                            startCol: current.col, startRow: current.row,
                            endCol:   next.col,    endRow:   next.row,
                            dir:      next.dir,
                        });
                    }
                }
                break;
            }

            const next = neighbors[Math.floor(Math.random() * neighbors.length)];
            used.add(`${next.col},${next.row}`);
            localSteps.push({
                startCol: current.col, startRow: current.row,
                endCol:   next.col,    endRow:   next.row,
                dir:      next.dir,
            });
            current = next;
        }

        // ⑤ 压缩 → path
        const path = this._compressPath(localSteps);
        if (path.length === 0) return null;

        // ⑥ flyDir = 最后一步方向
        const lastStep = localSteps[localSteps.length - 1];
        const flyDir = lastStep.dir;
        const headCol = lastStep.endCol;
        const headRow = lastStep.endRow;

        const d = DIR_MAP[flyDir];
        const nc = headCol + d.dx;
        const nr = headRow + d.dy;

        // ⑦ 边界检查：head 紧挨"安全边界"才算有效
        if (boundarySet === null) {
            // 第 1 轮：边界 = 物理边界（head 紧挨棋盘边缘）
            if (!(headCol === 0 || headCol === this.cols - 1 ||
                  headRow === 0 || headRow === this.rows - 1)) return null;
            // 确保 flyDir 指向棋盘外（head 在边缘但 flyDir 向内不算）
            if (this.dotMatrix.inside(nc, nr)) return null;
        } else {
            // 第 2+ 轮：边界 = 物理边界 + 前轮占据点
            // head 紧挨物理边界 → 直接出界，允许
            // head 紧挨的格子是被 boundarySet 线占据 → 允许
            if (this.dotMatrix.inside(nc, nr)) {
                const occ = this.dotMatrix.getOccupant(nc, nr);
                if (!occ || !boundarySet.has(occ)) return null;
            }
        }

        // ⑧ 射线全扫描：边界线不break，继续查对头箭
        const oppositeDir = { right: 'left', left: 'right', down: 'up', up: 'down' };
        let c = nc, r = nr;
        while (this.dotMatrix.inside(c, r)) {
            const occ = this.dotMatrix.getOccupant(c, r);
            if (occ) {
                // 对头箭 → 拒绝（无论是否在 boundarySet 中）
                if (occ.flyDir === oppositeDir[flyDir]) return null;
                // boundarySet 线 → 安全通道，但继续扫描后面
                if (boundarySet && boundarySet.has(occ)) { c += d.dx; r += d.dy; continue; }
                // 非 boundarySet 冲突 → 拒绝
                if (alreadyPlaced.has(occ)) return null;
            }
            c += d.dx;
            r += d.dy;
        }

        // ⑨ 回环检查：flyDir 射线穿过自己的格点 → 自指
        const bodySet = new Set();
        for (const s of localSteps) {
            bodySet.add(`${s.startCol},${s.startRow}`);
            bodySet.add(`${s.endCol},${s.endRow}`);
        }
        // 移除 head 本身（检查从 head+1 开始）
        bodySet.delete(`${headCol},${headRow}`);

        c = headCol + d.dx;
        r = headRow + d.dy;
        while (this.dotMatrix.inside(c, r)) {
            if (bodySet.has(`${c},${r}`)) return null;  // 自指
            c += d.dx;
            r += d.dy;
        }

        // ⑨ 返回构建参数
        return {
            tailCol: localSteps[0].startCol,
            tailRow: localSteps[0].startRow,
            path: path,
            flyDir: flyDir,
            headCol: headCol,
            headRow: headRow,
        };
    }

    // =========================================================================
    // _generateBatch — 在指定范围内按序列逆序构造一批线
    //
    // @param {Set}   alreadyPlaced — 前几轮已建线的 label 集合（本轮不能指向它们）
    // @param {number} targetN      — 尝试生成的线数
    // @param {function} onProgress — 回调
    // @returns {ArrowLine[]} 本轮成功生成的线
    // =========================================================================
    _generateBatch(alreadyPlaced, targetN, onProgress, baseBoundarySet = null, roundLabel = '') {
        const batch = [];
        const MAX_RETRIES = 40;

        // 累积边界 + 射线清场
        let accumBoundary = baseBoundarySet ? new Set(baseBoundarySet) : null;
        this.dotMatrix._reservedSet = new Set();  // 每批重置预留

        for (let i = 0; i < targetN; i++) {
            let build = null;
            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                build = this._tryGenerateLine(alreadyPlaced, accumBoundary);
                if (build) break;
            }
            if (!build) continue;

            const line = new ArrowLine(
                this.scene, this.container, this.dotMatrix,
                build.tailCol, build.tailRow,
                build.path,
                this.toX, this.toY, this.DIR,
                '',
                (type, detail) => { this._logEvent(type, line._seqLabel, detail); }
            );
            line._round = roundLabel;
            if (line.steps.length > 0) {
                this.dotMatrix.occupy(line.steps[0].endCol, line.steps[0].endRow, line);
            }

            batch.push(line);

            // 加入累积边界：后面建的人可以安全指向它
            if (accumBoundary === null) accumBoundary = new Set();
            accumBoundary.add(line);

            // 射线清场：本线的飞行路径上的空格，后序线不得占用
            const rd = DIR_MAP[line.flyDir];
            let rc = line.headCol + rd.dx;
            let rr = line.headRow + rd.dy;
            while (this.dotMatrix.inside(rc, rr)) {
                if (!this.dotMatrix.getOccupant(rc, rr)) {
                    this.dotMatrix._reservedSet.add(`${rc},${rr}`);
                }
                rc += rd.dx;
                rr += rd.dy;
            }
        }

        // 正序追加：建线顺序 = 发射顺序 = 标签顺序
        this.lines.push(...batch);
        this._renumberLines();
        this.order = Array.from({ length: this.lines.length }, (_, i) => i + 1);
        batch._finalLabels = batch.map(l => l.label);

        for (const line of batch) {
            if (onProgress) onProgress(line, this.lines.length);
        }
        return batch;
    }

    // =========================================================================
    // _topoReorderBatch — 对一批线做拓扑排序，调整在 lines 中的顺序
    //
    // 目标：标签小的先飞。当前 lines 中 batch 占 [0..batchLen-1]，
    // renumber 后 lines[0]=大号(后飞)，lines[batchLen-1]=小号(先飞)。
    // 所以拓扑序(先飞→后飞)应放在 batch 区域的尾部→头部（逆序）。
    // =========================================================================
    _topoReorderBatch(batch) {
        if (batch.length <= 1) return;

        const n = this.lines.length;
        const batchLen = batch.length;
        const batchSet = new Set(batch);

        // ① 构建批次内依赖：A → B 表示 B 必须先飞
        const deps = new Map();      // A → B
        const indegree = new Map();  // B → 入度
        for (const line of batch) { indegree.set(line, 0); }

        for (const A of batch) {
            const d = DIR_MAP[A.flyDir];
            let c = A.headCol + d.dx;
            let r = A.headRow + d.dy;
            while (this.dotMatrix.inside(c, r)) {
                const occ = this.dotMatrix.getOccupant(c, r);
                if (occ && occ !== A && batchSet.has(occ)) {
                    deps.set(A, occ);
                    indegree.set(occ, (indegree.get(occ) || 0) + 1);
                    break;
                }
                c += d.dx;
                r += d.dy;
            }
        }

        // ② Kahn 拓扑排序
        const queue = [];
        for (const [line, deg] of indegree) {
            if (deg === 0) queue.push(line);
        }

        const topoOrder = [];
        while (queue.length > 0) {
            const node = queue.shift();
            topoOrder.push(node);
            // 找 deps 中依赖 node 的线
            for (const [A, B] of deps) {
                if (B === node) {
                    const newDeg = (indegree.get(A) || 0) - 1;
                    indegree.set(A, newDeg);
                    if (newDeg === 0) queue.push(A);
                }
            }
        }

        // 如果拓扑排序不完整（有环），保持原顺序
        if (topoOrder.length !== batch.length) return;

        // ③ 重新排列 lines：topoOrder[0]=先飞 → 放在 batch 区域最高索引（小号）
        //    topoOrder[last]=后飞 → 放在 batch 区域最低索引（大号）
        for (let i = 0; i < batchLen; i++) {
            // 先飞的在后面，后飞的在前面
            this.lines[i] = topoOrder[batchLen - 1 - i];
        }
    }

    // =========================================================================
    // _renumberLines — 统一重新编号：先建的=小号=先飞
    // =========================================================================
    _renumberLines() {
        const total = this.lines.length;
        for (let i = 0; i < total; i++) {
            const newLabel = String(i + 1);
            const line = this.lines[i];
            line.label = newLabel;
            line._seqLabel = newLabel;
            line._labelImg?.destroy();
            line._labelImg = null;
            line._onEvent = (type, detail) => { this._logEvent(type, newLabel, detail); };
            if (ArrowLine.DEV) line._makeLabel(this.toX, this.toY);
        }
    }

    // =========================================================================
    // startGeneration — 初始化分步生成（清空线，准备第一轮）
    // =========================================================================
    startGeneration() {
        this._clearAllLines();
        this.order = [];
        this.orderIndex = 0;
        this.batches = [];
        this._genState = 'generating';
        this._genFirstDone = false;
        this._genQueue = [];       // [{roundId, cells}]
        this._genAlreadyPlaced = new Set();
    }

    // =========================================================================
    // _clearAllLines — 清空所有线（保留 dotMatrix 占用）
    // =========================================================================
    _clearAllLines() {
        for (const line of this.lines.slice()) {
            line._dispose();
        }
        this.lines = [];
    }

    // =========================================================================
    // _discardBatch — 从 lines 头部移除并销毁一批线
    // =========================================================================
    _discardBatch(batch) {
        for (const line of batch) {
            line._dispose();
            const idx = this.lines.indexOf(line);
            if (idx !== -1) this.lines.splice(idx, 1);
        }
    }

    // =========================================================================
    // _batchLabelRange — 根据批次在 lines 中的位置计算最终 label 区间
    //   unshift 到头部 → 批次占 lines[0..count-1]，标签 = [N-count+1, N]
    _batchLabelRange(count) {
        const N = this.lines.length;
        return `[${N - count + 1}-${N}]`;
    }
    //
    // @returns {{round, region, regionSize, count}|null}
    // =========================================================================
    generateNextBatch(onProgress) {
        if (this._genState !== 'generating') return null;

        const totalPoints = this.cols * this.rows;
        const MAX_RETRIES = 5;

        // -------- 第 1 轮：全棋盘 --------
        if (!this._genFirstDone) {
            this._genFirstDone = true;
            const N = CONFIG.ARROW_MATRIX.ROUND1_LINES;
            let batch = this._genBatchWithRetry(this._genAlreadyPlaced, N, MAX_RETRIES, null, '1');
            for (const l of batch) this._genAlreadyPlaced.add(l);
            const info = { round: '1', region: '全棋盘', regionSize: totalPoints,
                count: batch.length, labels: this._batchLabelRange(batch.length),
                order: batch._finalLabels || [], cells: [] };
            this.batches.push(info);
            if (ArrowLine.DEV) console.log(`[箭头阵] ${info.round}: ${info.region} → ${info.count} 条线 ${info.labels} 建序=${info.order.join(',')}`);

            // 首轮后的空区域入队，父ID = "1"
            this._enqueueSubRegions('1');
            return info;
        }

        // -------- 队列处理 --------
        if (this._genQueue.length === 0) {
            this._finishGeneration();
            return null;
        }

        const task = this._genQueue.shift();
        const { roundId, cells } = task;

        const filterSet = new Set(cells.map(p => `${p.col},${p.row}`));
        this.dotMatrix._regionFilter = filterSet;

        const regionN = Math.min(cells.length, 20);
        const batch = this._genBatchWithRetry(this._genAlreadyPlaced, regionN, MAX_RETRIES, this._genAlreadyPlaced, roundId);
        for (const l of batch) this._genAlreadyPlaced.add(l);

        // 空区域无论产出都记录 batch（保持编号连续），但只有有产出的才入队子空区
        const info = { round: roundId, region: `空区(${cells.length}格)`, regionSize: cells.length,
            count: batch.length, labels: batch.length > 0 ? this._batchLabelRange(batch.length) : '-',
            order: (batch._finalLabels || []), cells: cells.map(p => [p.col, p.row]) };
        this.batches.push(info);
        if (ArrowLine.DEV) {
            const msg = batch.length > 0 ? `${info.count} 条线 ${info.labels} 建序=${info.order.join(',')}` : '无产出';
            console.log(`[箭头阵] ${info.round}: ${info.region} → ${msg}`);
        }
        if (batch.length > 0) this._enqueueSubRegions(roundId);

        this.dotMatrix._regionFilter = null;
        return info;
    }

    // =========================================================================
    // _enqueueSubRegions — 子编号 = 父ID + "-" + 序号
    // =========================================================================
    _enqueueSubRegions(parentId) {
        const regions = this.dotMatrix.getEmptyRegions();
        const fillable = regions.filter(r => r.size > 1);
        for (let i = fillable.length - 1; i >= 0; i--) {
            const childIdx = fillable.length - i;
            const roundId = `${parentId}-${childIdx}`;
            this._genQueue.push({ roundId, cells: fillable[i].cells });
        }
    }

    // =========================================================================
    // _genBatchWithRetry — 生成一批 + 同批内互指重试
    // =========================================================================
    _genBatchWithRetry(alreadyPlaced, targetN, maxRetries, boundarySet = null, roundLabel = '') {
        let batch = this._generateBatch(alreadyPlaced, targetN, null, boundarySet, roundLabel);
        for (let retry = 0; retry < maxRetries && batch.length > 0 && !this._isSolvable(); retry++) {
            this._discardBatch(batch);
            batch = this._generateBatch(alreadyPlaced, targetN, null, boundarySet, roundLabel);
        }
        return batch;
    }

    // =========================================================================
    // _finishGeneration — 结束生成，重新编号，锁定快照
    // =========================================================================
    _finishGeneration() {
        this._genState = 'idle';
        this._renumberLines();
        this.order = Array.from({ length: this.lines.length }, (_, i) => i + 1);
        this.orderIndex = 0;
        this.generationStartTime = Date.now();
        this.dotMatrix._reservedSet = null;  // 清空预留，不影响后续游戏
        this.initialSnapshot = this._takeSnapshot();

        if (ArrowLine.DEV) {
            const total = this.lines.length;
            const regions = this.dotMatrix.getEmptyRegions();
            const single = regions.filter(r => r.size === 1).length;
            const multi = regions.filter(r => r.size > 1).length;
            console.log(`[箭头阵] 分步生成完成：${total} 条线，空区=${regions.length}（单点${single} 多格${multi}），环数=${this._countCycles()}`);
            for (const b of this.batches) {
                console.log(`  ${b.round}: ${b.region} → ${b.count} 条线 ${b.labels}`);
            }
        }
    }

    // =========================================================================
    // isGenerationDone — 分步生成是否已结束
    // =========================================================================
    isGenerationDone() {
        return this._genState === 'idle';
    }

    // =========================================================================
    // autoSolve — 每次找无阻挡且标签最小的线来飞，避免碰撞
    // =========================================================================
    autoSolve(onTick) {
        const step = () => {
            const candidates = this.getUnblockedLines();
            if (candidates.length === 0) {
                const alive = this.lines.filter(l => l.steps.length > 0);
                if (alive.length === 0) {
                    if (onTick) onTick(null, 'done');
                } else {
                    if (onTick) onTick(null, 'stuck');
                }
                return;
            }
            candidates.sort((a, b) => Number(a.label) - Number(b.label));
            const line = candidates[0];
            line.advance();
            if (onTick) onTick(line, 'advance');
            this.scene.time.delayedCall(500, step);
        };
        step();
    }

    // =========================================================================
    // generateAll — 一键全部生成（复用分步逻辑）
    // =========================================================================
    generateAll(onProgress) {
        this.startGeneration();
        while (this.generateNextBatch(onProgress)) { /* 循环直到结束 */ }
        return this.lines.length;
    }

    // =========================================================================
    // _isSolvable — 构建依赖图，拓扑排序检查是否有环
    //
    // 依赖定义：从 A 的头尖点沿 flyDir 逐格走，第一个碰到的其他线 B
    //          → A 依赖 B（B 必须先飞才能给 A 让路）
    //
    // 环 = 无解。DAG = 有至少一种合法发射顺序。
    // =========================================================================
    _isSolvable() {
        if (this.lines.length <= 1) return true;

        // ① 构建依赖图：A 依赖 B 表示 B 必须先飞
        const n = this.lines.length;
        const deps = [];       // deps[i] = [j, ...]  i 依赖 j
        const revDeps = [];    // revDeps[i] = [k, ...]  k 依赖 i（反向索引）

        for (let i = 0; i < n; i++) {
            deps.push([]);
            revDeps.push([]);
        }

        for (let ai = 0; ai < n; ai++) {
            const A = this.lines[ai];
            const d = DIR_MAP[A.flyDir];
            let c = A.headCol + d.dx;
            let r = A.headRow + d.dy;
            while (this.dotMatrix.inside(c, r)) {
                const occupant = this.dotMatrix.getOccupant(c, r);
                if (occupant && occupant !== A) {
                    const bi = this.lines.indexOf(occupant);
                    if (bi !== -1) {
                        deps[ai].push(bi);
                        revDeps[bi].push(ai);
                    }
                    break;
                }
                c += d.dx;
                r += d.dy;
            }
        }

        // ② 拓扑排序（Kahn 算法）
        const indegree = deps.map(d => d.length);
        const queue = [];
        for (let i = 0; i < n; i++) {
            if (indegree[i] === 0) queue.push(i);
        }

        let visited = 0;
        while (queue.length > 0) {
            const node = queue.shift();
            visited++;
            // node 被移除 → 依赖 node 的那些线（反向依赖）入度 -1
            for (const dependent of revDeps[node]) {
                indegree[dependent]--;
                if (indegree[dependent] === 0) queue.push(dependent);
            }
        }

        return visited === n;
    }

    // =========================================================================
    // _countCycles — 统计依赖图中的环数
    // =========================================================================
    _countCycles() {
        const n = this.lines.length;
        if (n <= 1) return 0;

        const deps = [];
        for (let ai = 0; ai < n; ai++) {
            const A = this.lines[ai];
            const d = DIR_MAP[A.flyDir];
            let c = A.headCol + d.dx;
            let r = A.headRow + d.dy;
            let dep = null;
            while (this.dotMatrix.inside(c, r)) {
                const occ = this.dotMatrix.getOccupant(c, r);
                if (occ && occ !== A) {
                    const bi = this.lines.indexOf(occ);
                    if (bi !== -1) dep = bi;
                    break;
                }
                c += d.dx;
                r += d.dy;
            }
            deps.push(dep);
        }

        const visited = new Array(n).fill(false);
        const inStack = new Array(n).fill(false);
        let count = 0;

        const dfs = (node) => {
            visited[node] = true;
            inStack[node] = true;
            const next = deps[node];
            if (next !== null && next !== undefined) {
                if (inStack[next]) count++;
                else if (!visited[next]) dfs(next);
            }
            inStack[node] = false;
        };

        for (let i = 0; i < n; i++) {
            if (!visited[i]) dfs(i);
        }
        return count;
    }

    // =========================================================================
    // getUnblockedLines — 返回前方无阻挡的活跃线（indegree=0，可发射）
    // =========================================================================
    getUnblockedLines() {
        const result = [];
        for (const line of this.lines) {
            if (line.steps.length === 0) continue;  // 已销毁
            if (line._moving) continue;              // 飞行/回退中

            const d = DIR_MAP[line.flyDir];
            let c = line.headCol + d.dx;
            let r = line.headRow + d.dy;
            let blocked = false;
            while (this.dotMatrix.inside(c, r)) {
                const occupant = this.dotMatrix.getOccupant(c, r);
                if (occupant && occupant !== line && occupant.steps.length > 0 && !occupant._moving) {
                    blocked = true;
                    break;
                }
                c += d.dx;
                r += d.dy;
            }
            if (!blocked) result.push(line);
        }
        return result;
    }

    // =========================================================================
    // peekNextSequenceLine — 只查看序列中的下一条线（不推进 orderIndex）
    // =========================================================================
    peekNextSequenceLine() {
        // 跳过已飞走或找不到的线
        while (this.orderIndex < this.order.length) {
            const label = String(this.order[this.orderIndex]);
            const line = this.lines.find(l => l.label === label);
            if (line && line.steps.length > 0 && !line._moving) return line;
            this.orderIndex++;  // 跳过死线
        }
        return null;
    }

    // _isRobust — 检查不存在「对头箭」：同射线相向飞行的两个箭头
    //
    // 红线：两个箭头面对面，中间线终被移除 → 互指死锁，任何拓扑序都无法避免。
    // 其他依赖链问题由玩家操作约束解决（只能点前方无阻挡的线）。
    // =========================================================================
    _isRobust() {
        if (this.lines.length <= 1) return true;

        const oppositeDir = { right: 'left', left: 'right', down: 'up', up: 'down' };

        for (const A of this.lines) {
            const d = DIR_MAP[A.flyDir];
            let c = A.headCol + d.dx;
            let r = A.headRow + d.dy;
            while (this.dotMatrix.inside(c, r)) {
                const occ = this.dotMatrix.getOccupant(c, r);
                if (occ && occ !== A && occ.flyDir === oppositeDir[A.flyDir]) return false;
                c += d.dx;
                r += d.dy;
            }
        }

        return true;
    }

    // =========================================================================
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

        // ⑥ 创建 ArrowLine（注入事件回调）
        const label = String(this.lines.length);
        const line = new ArrowLine(
            this.scene, this.container, this.dotMatrix,
            steps[0].startCol, steps[0].startRow,
            path,
            this.toX, this.toY, this.DIR,
            label,
            (type, detail) => { this._logEvent(type, label, detail); }
        );

        // 补注册箭头尖端（_registerPoints 跳过它）
        if (line.steps.length > 0) {
            const tip = line.steps[0];
            this.dotMatrix.occupy(tip.endCol, tip.endRow, line);
        }

        return line;
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
    // _logEvent — 记录一条操作事件
    // =========================================================================
    _logEvent(type, label, detail) {
        if (type !== 'generate') {
            // 首次非 generate 事件 → 切换到 mid-execution
            if (this._stats.advances + this._stats.retreats + this._stats.collisions + this._stats.disposals === 0) {
                // phase 切换由 dump() 的 summary 自动推断
            }
        }

        this.eventSeq++;
        const ts = this.generationStartTime ? Date.now() - this.generationStartTime : 0;

        this.eventLog.push({
            seq: this.eventSeq,
            type: type,
            label: label,
            ts: ts,
            detail: detail,
        });

        // 统计
        if (type === 'click') this._stats.clicks++;
        else if (type === 'advance') this._stats.advances++;
        else if (type === 'retreat') this._stats.retreats++;
        else if (type === 'collision') this._stats.collisions++;
        else if (type === 'dispose') this._stats.disposals++;
    }

    // =========================================================================
    // _lineSnapshot — 对一条线拍快照
    // =========================================================================
    _lineSnapshot(line, index) {
        return {
            index: index,
            label: line.label,
            round: line._round || '',
            flyDir: line.flyDir,
            headCol: line.headCol,
            headRow: line.headRow,
            tailCol: line.tailCol,
            tailRow: line.tailRow,
            stepCount: line.steps.length,
            path: line.path.map(v => `${v.dir}×${v.count}`).join(' → '),
            disposed: line.steps.length === 0,
        };
    }

    // =========================================================================
    // _takeSnapshot — 对当前阵状态拍完整快照
    // =========================================================================
    _takeSnapshot() {
        // 依赖图 + 环检测
        const deps = {};
        for (let ai = 0; ai < this.lines.length; ai++) {
            const A = this.lines[ai];
            const d = DIR_MAP[A.flyDir];
            let c = A.headCol + d.dx;
            let r = A.headRow + d.dy;
            let depIndex = null;
            while (this.dotMatrix.inside(c, r)) {
                const occupant = this.dotMatrix.getOccupant(c, r);
                if (occupant && occupant !== A) {
                    depIndex = this.lines.indexOf(occupant);
                    break;
                }
                c += d.dx;
                r += d.dy;
            }
            deps[ai] = depIndex;
        }

        const visited = new Set();
        const inStack = new Set();
        const cycles = [];
        const dfs = (node, path) => {
            visited.add(node);
            inStack.add(node);
            path.push(node);
            const dep = deps[node];
            if (dep !== null && dep !== undefined) {
                if (inStack.has(dep)) {
                    const cycleStart = path.indexOf(dep);
                    cycles.push(path.slice(cycleStart).concat(dep).join(' → '));
                } else if (!visited.has(dep)) {
                    dfs(dep, path);
                }
            }
            path.pop();
            inStack.delete(node);
        };
        for (let i = 0; i < this.lines.length; i++) {
            if (!visited.has(i)) dfs(i, []);
        }

        return {
            totalLines: this.lines.length,
            solvable: this._isSolvable(),
            lines: this.lines.map((l, i) => this._lineSnapshot(l, i)),
            dependencies: deps,
            cycles: cycles,
        };
    }

    // =========================================================================
    // dump — 导出完整日志（六段结构）
    // =========================================================================
    dump() {
        // 首次调用：锁定 initialSnapshot
        if (!this.initialSnapshot) {
            this.initialSnapshot = this._takeSnapshot();
        }

        const phase = (this._stats.clicks + this._stats.advances + this._stats.retreats + this._stats.collisions + this._stats.disposals === 0)
            ? 'initial' : 'mid-execution';

        // 统计行内/行外线数
        let linesInBounds = 0;
        let linesOutOfBounds = 0;
        let linesDisposed = 0;
        for (const line of this.lines) {
            if (line.steps.length === 0) { linesDisposed++; continue; }
            if (line.isInside()) linesInBounds++;
            else linesOutOfBounds++;
        }

        const report = {
            meta: {
                version: 1,
                exportedAt: new Date().toISOString(),
                config: { cols: this.cols, rows: this.rows, spacing: this.spacing },
            },
            initialState: this.initialSnapshot,
            summary: {
                phase: phase,
                totalEvents: this.eventSeq,
                clicks: this._stats.clicks,
                advances: this._stats.advances,
                retreats: this._stats.retreats,
                collisions: this._stats.collisions,
                disposals: this._stats.disposals,
                linesInBounds: linesInBounds,
                linesOutOfBounds: linesOutOfBounds,
                linesDisposed: linesDisposed,
            },
            batches: this.batches,
            events: this.eventLog,
            currentState: this._takeSnapshot(),
        };

        console.log(JSON.stringify(report, null, 2));
        return report;
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
