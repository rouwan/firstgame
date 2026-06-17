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

        // ======== 实验：线信息日志 ========
        this._lineLog = [];   // [{ label, flyDir, head, adj, tail, body, green, blue, orange }]

        // ======== 分步生成状态 ========
        this._genState = 'idle';          // 'idle' | 'generating'
        this._phase = 0;                  // 1=线1, 2=线2前序, 3=线3边界+向内走
        this._typeCount = { '1': 0, '2': 0, '3': 0 };
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
    // _highlightAdjacent — 绿=箭头候选，蓝=邻点候选，橙=不可用
    // =========================================================================
    _highlightAdjacent(line, greenColor, blueColor) {
        const bodySet = new Set();
        const greenSet = new Set();       // "col,row" → true
        const greenDir = new Map();       // "col,row" → [[dc,dr], ...]
        const validSet = new Set();       // 有效绿格（能放邻格的）
        this._highlightData = { body: [], green: [], blue: [], orange: [], candidates: [] };
        for (const s of line.steps) {
            bodySet.add(`${s.startCol},${s.startRow}`); bodySet.add(`${s.endCol},${s.endRow}`);
            this._highlightData.body.push([s.startCol, s.startRow], [s.endCol, s.endRow]);
        }

        // 所有前辈线的身体集合（绿格 + 射线检查共用）
        const allBodySet = new Set(bodySet);
        for (const l of this.lines) {
            if (l === line) continue;
            for (const s of l.steps) {
                allBodySet.add(`${s.startCol},${s.startRow}`);
                allBodySet.add(`${s.endCol},${s.endRow}`);
            }
        }

        // 绿格从所有前辈线身体计算（不只是当前线）
        const bodyForGreen = this.lines.length <= 1 ? bodySet : allBodySet;

        // 第一遍：涂绿 + 记方向（用所有前辈线身体）
        for (const k of bodyForGreen) {
            const [c, r] = k.split(',').map(Number);
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dc, dr] of dirs) {
                const nc = c + dc, nr = r + dr;
                if (!this.dotMatrix.inside(nc, nr)) continue;
                if (bodyForGreen.has(`${nc},${nr}`)) continue;
                if (this.dotMatrix.getOccupant(nc, nr)) continue;
                const gk = `${nc},${nr}`;
                greenSet.add(gk);
                if (!greenDir.has(gk)) greenDir.set(gk, []);
                greenDir.get(gk).push([dc, dr]);
                this._highlightData.green.push([nc, nr]);
                const img = this.dotMatrix.grid[nr][nc].image;
                if (img) img.setTint(greenColor);
            }
        }

        // 第二遍：有效绿格 = 邻点可用 + 射线全是线1身体（无空点）
        for (const [gk, dirs] of greenDir) {
            const [gc, gr] = gk.split(',').map(Number);
            for (const [dc, dr] of dirs) {
                const bc = gc + dc, br = gr + dr;
                if (!this.dotMatrix.inside(bc, br)) continue;
                if (bodyForGreen.has(`${bc},${br}`)) continue;
                if (this.dotMatrix.getOccupant(bc, br)) continue;

                // 射线全扫描：从箭头点沿 flyDir(-dc,-dr) 逐格走，必须全是前序线身体
                const fdx = -dc, fdy = -dr;
                let rc = gc + fdx, rr = gr + fdy;
                let allBody = true;
                while (this.dotMatrix.inside(rc, rr)) {
                    if (!allBodySet.has(`${rc},${rr}`)) { allBody = false; break; }
                    rc += fdx; rr += fdy;
                }
                if (!allBody) continue;

                validSet.add(gk);
                const flyDir = fdx === 1 ? 'right' : fdx === -1 ? 'left' : fdy === 1 ? 'down' : 'up';
                this._highlightData.candidates.push({ head: [gc, gr], adj: [bc, br], flyDir });
                if (!greenSet.has(`${bc},${br}`)) {
                    this._highlightData.blue.push([bc, br]);
                    const img = this.dotMatrix.grid[br][bc].image;
                    if (img) img.setTint(blueColor);
                }
                break;
            }
        }

        // 第三遍：无效绿格 → 涂橙
        for (const gk of greenSet) {
            if (!validSet.has(gk)) {
                const [gc, gr] = gk.split(',').map(Number);
                this._highlightData.orange.push([gc, gr]);
                const img = this.dotMatrix.grid[gr][gc].image;
                if (img) img.setTint(0xff8800);
            }
        }
    }

    // =========================================================================
    // dump — 导出完整点阵 + 所有线信息
    // =========================================================================
    dump() {
        // 点阵状态
        const grid = [];
        for (let r = 0; r < this.rows; r++) {
            grid[r] = [];
            for (let c = 0; c < this.cols; c++) {
                const occ = this.dotMatrix.getOccupant(c, r);
                grid[r][c] = occ ? { owner: occ.label } : null;
            }
        }
        return {
            config: { cols: this.cols, rows: this.rows, spacing: this.spacing },
            totalLines: this.lines.length,
            grid: grid,
            lines: this._lineLog,
        };
    }

    dumpLine1() { return this.dump(); }

    // =========================================================================
    // generateLine1 — 三定点：箭头点(边界) + 邻点(内侧) + 尾巴(随机)，BFS
    // =========================================================================
    // =========================================================================
    // generateNextLine — 内部单条生成（按当前 phase 决定类型）
    // =========================================================================
    generateNextLine() {
        if (this._phase === 2 && this._highlightData?.candidates?.length > 0) {
            const line = this._generateSingleLine('2');
            if (line) { this._highlightAdjacent(line, 0x44ff44, 0x4488ff); return line; }
        }
        if (this._phase === 3) {
            const line = this._generateSingleLine('3');
            if (line) { this._highlightAdjacent(line, 0x44ff44, 0x4488ff); return line; }
        }
        if (this._phase <= 1) {
            const line = this._generateSingleLine('1');
            if (line) { this._highlightAdjacent(line, 0x44ff44, 0x4488ff); return line; }
        }
        return null;
    }

    // =========================================================================
    // generateNextBatch — 三阶段交替：1→2→3→1→...
    // =========================================================================
    generateNextBatch(phase) {
        const count = CONFIG.ARROW_MATRIX.LINE1_COUNT || 6;

        if (phase === 1) {
            let made = 0;
            for (let i = 0; i < count; i++) { if (this._generateSingleLine('1')) made++; }
            const lastLine = this.lines[this.lines.length - 1];
            if (lastLine) this._highlightAdjacent(lastLine, 0x44ff44, 0x4488ff);
            console.log(`[线1] ${made}/${count}`);
            return made > 0 ? '1' : null;
        }
        if (phase === 2) {
            let made = 0;
            while (this._highlightData?.candidates?.length > 0) {
                const line = this._generateSingleLine('2');
                if (!line) break;
                this._highlightAdjacent(line, 0x44ff44, 0x4488ff);
                made++;
            }
            console.log(`[线2] ${made}条`);
            return made > 0 ? '2' : null;
        }
        if (phase === 3) {
            let made = 0;
            for (let i = 0; i < count; i++) { if (this._generateSingleLine('3')) made++; }
            const lastLine = this.lines[this.lines.length - 1];
            if (lastLine && made > 0) this._highlightAdjacent(lastLine, 0x44ff44, 0x4488ff);
            console.log(`[线3] ${made}/${count}`);
            return made > 0 ? '3' : null;
        }
        if (phase === 4) {
            let made = 0;
            const regions = this.dotMatrix.getEmptyRegions();
            for (const region of regions) {
                if (region.size < 2) continue;
                if (!this._typeCount['4']) this._typeCount['4'] = 0;
                this._typeCount['4']++;
                const label = `4-${this._typeCount['4']}`;
                // BFS 从第一个空格到最后一个空格
                const from = region.cells[0];
                const to = region.cells[region.cells.length - 1];
                const cells = this._bfsPath(from, to);
                if (!cells) continue;
                const path = this._cellsToPath(cells);
                if (path.length === 0) continue;
                this._createLine(label, from.col, from.row, path, from, to, 'down');
                made++;
            }
            console.log(`[线4] 清场${made} 条`);
            return made > 0 ? '4' : null;
        }
        return null;
    }

    // =========================================================================
    // _generateSingleLine — type: '1'=边界+BFS, '2'=前序绿格, '3'=边界+向内走
    // =========================================================================
    _generateSingleLine(type) {
        if (!this._typeCount[type]) this._typeCount[type] = 0;
        this._typeCount[type]++;
        const label = `${type}-${this._typeCount[type]}`;
        let candidates = [];

        if (type === '2') {
            // 线2：前序线绿格候选
            const data = this._highlightData;
            if (!data?.candidates?.length) { console.log(`[${label}] 无候选`); return null; }
            for (const c of data.candidates) {
                candidates.push({ head: { col: c.head[0], row: c.head[1] }, adj: { col: c.adj[0], row: c.adj[1] }, flyDir: c.flyDir });
            }
        } else {
            // 线1 / 线3：边界空格 + 内侧邻点
            for (let c = 0; c < this.cols; c++) {
                if (!this.dotMatrix.getOccupant(c, 0)) { const adj = { col: c, row: 1 }; if (this.dotMatrix.inside(adj.col, adj.row) && !this.dotMatrix.getOccupant(adj.col, adj.row)) candidates.push({ head: { col: c, row: 0 }, adj, flyDir: 'up' }); }
                if (!this.dotMatrix.getOccupant(c, this.rows - 1)) { const adj = { col: c, row: this.rows - 2 }; if (this.dotMatrix.inside(adj.col, adj.row) && !this.dotMatrix.getOccupant(adj.col, adj.row)) candidates.push({ head: { col: c, row: this.rows - 1 }, adj, flyDir: 'down' }); }
            }
            for (let r = 0; r < this.rows; r++) {
                if (!this.dotMatrix.getOccupant(0, r)) { const adj = { col: 1, row: r }; if (this.dotMatrix.inside(adj.col, adj.row) && !this.dotMatrix.getOccupant(adj.col, adj.row)) candidates.push({ head: { col: 0, row: r }, adj, flyDir: 'left' }); }
                if (!this.dotMatrix.getOccupant(this.cols - 1, r)) { const adj = { col: this.cols - 2, row: r }; if (this.dotMatrix.inside(adj.col, adj.row) && !this.dotMatrix.getOccupant(adj.col, adj.row)) candidates.push({ head: { col: this.cols - 1, row: r }, adj, flyDir: 'right' }); }
            }
        }
        if (candidates.length === 0) { console.log(`[${label}] 无候选`); return null; }

        if (type === '3') return this._buildLine3(label, candidates);
        return this._buildLineBFSTail(label, candidates);
    }

    // =========================================================================
    // _buildLineBFSTail — BFS 尾巴到邻点（线1/线2 共用）
    // =========================================================================
    _buildLineBFSTail(label, candidates) {
        const tails = [];
        for (let r = 0; r < this.rows; r++)
            for (let c = 0; c < this.cols; c++)
                if (!this.dotMatrix.getOccupant(c, r)) tails.push({ col: c, row: r });
        if (tails.length < 2) { console.log(`[${label}] 空格不足`); return null; }

        for (let attempt = 0; attempt < 200; attempt++) {
            const h = candidates[Math.floor(Math.random() * candidates.length)];
            const tail = tails[Math.floor(Math.random() * tails.length)];
            if ((tail.col === h.head.col && tail.row === h.head.row) || (tail.col === h.adj.col && tail.row === h.adj.row)) continue;
            const excludeSet = new Set([`${h.head.col},${h.head.row}`]);
            const cells = this._bfsPath(tail, h.adj, excludeSet);
            if (!cells) continue;
            cells.push({ col: h.head.col, row: h.head.row });
            const path = this._cellsToPath(cells);
            if (path.length === 0) continue;
            return this._createLine(label, h.adj.col, h.adj.row, path, tail, h.head, h.flyDir);
        }
        console.log(`[${label}] BFS 200 次未通`);
        return null;
    }

    // =========================================================================
    // _buildLine3 — 线3：从邻点向内随机游走，直到无空格
    // =========================================================================
    _buildLine3(label, candidates) {
        for (let attempt = 0; attempt < 200; attempt++) {
            const h = candidates[Math.floor(Math.random() * candidates.length)];
            const walkCells = [{ col: h.adj.col, row: h.adj.row }];
            const visited = new Set([`${h.head.col},${h.head.row}`, `${h.adj.col},${h.adj.row}`]);
            let cur = { col: h.adj.col, row: h.adj.row };
            // 从邻点向内随机走
            while (true) {
                const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                const emptyNeighbors = [];
                for (const [dc, dr] of dirs) {
                    const nc = cur.col + dc, nr = cur.row + dr;
                    if (this.dotMatrix.inside(nc, nr) && !visited.has(`${nc},${nr}`) && !this.dotMatrix.getOccupant(nc, nr)) {
                        emptyNeighbors.push({ col: nc, row: nr });
                    }
                }
                if (emptyNeighbors.length === 0) break;
                const next = emptyNeighbors[Math.floor(Math.random() * emptyNeighbors.length)];
                visited.add(`${next.col},${next.row}`);
                walkCells.push(next);
                cur = next;
            }
            // 路径：walkCells[0]=邻点 walkCells[last]=尾巴 → 从后往前建 path
            walkCells.reverse();  // [尾巴, ..., 邻点]
            walkCells.push({ col: h.head.col, row: h.head.row });  // 尾巴,...,邻点,头
            const path = this._cellsToPath(walkCells);
            if (path.length === 0) continue;
            const tail = walkCells[0];  // 最内点 = 尾巴
            return this._createLine(label, tail.col, tail.row, path, tail, h.head, h.flyDir);
        }
        console.log(`[${label}] 向内走 200 次未通`);
        return null;
    }

    // =========================================================================
    // _createLine — 创建 ArrowLine 并记录日志
    // =========================================================================
    _createLine(label, adjCol, adjRow, path, tail, head, flyDir) {
        const line = new ArrowLine(this.scene, this.container, this.dotMatrix, tail.col, tail.row, path, this.toX, this.toY, this.DIR, label, null);
        if (line.steps.length > 0) { this.dotMatrix.occupy(line.steps[0].endCol, line.steps[0].endRow, line); }
        this.lines.push(line);
        console.log(`[${label}] tail(${tail.col},${tail.row}) → adj(${adjCol},${adjRow}) → head(${head.col},${head.row}) flyDir=${flyDir}`);
        const hd = this._highlightData || { body: [], green: [], blue: [], orange: [] };
        this._lineLog.push({ label: line.label, flyDir: line.flyDir, head: [line.headCol, line.headRow], adj: [adjCol, adjRow], tail: [tail.col, tail.row], body: hd.body.slice(), green: hd.green.slice(), blue: hd.blue.slice(), orange: hd.orange.slice() });
        return line;
    }

    // =========================================================================
    // generateLine1 / generateLine2 — 兼容旧调用
    // =========================================================================
    generateLine1() { return this.lines.length === 0 ? this.generateNextLine() : null; }

    // =========================================================================
    // _tryGenerate — BFS 连接头尾，创建 ArrowLine
    _tryGenerate(headCells, label) {
        const allEmpty = [];
        for (let r = 0; r < this.rows; r++)
            for (let c = 0; c < this.cols; c++)
                if (!this.dotMatrix.getOccupant(c, r)) allEmpty.push({ col: c, row: r });

        for (let attempt = 0; attempt < 200; attempt++) {
            const head = headCells[Math.floor(Math.random() * headCells.length)];
            const tail = allEmpty[Math.floor(Math.random() * allEmpty.length)];
            if (head.col === tail.col && head.row === tail.row) continue;

            const cells = this._bfsPath(tail, head);
            if (!cells) continue;

            const path = this._cellsToPath(cells);
            if (path.length === 0) continue;

            const line = new ArrowLine(
                this.scene, this.container, this.dotMatrix,
                tail.col, tail.row, path,
                this.toX, this.toY, this.DIR,
                label, null
            );
            if (line.steps.length > 0) {
                this.dotMatrix.occupy(line.steps[0].endCol, line.steps[0].endRow, line);
            }
            this.lines.push(line);
            console.log(`[${label}] tail(${tail.col},${tail.row}) → head(${head.col},${head.row}) flyDir=${line.flyDir}`);
            return line;
        }
        console.log(`[${label}] BFS 200 次未找到路径`);
        return null;
    }

    // =========================================================================
    // _bfsPath — 四方向 BFS 最短路径
    // =========================================================================
    _bfsPath(from, to, excludeCells = null) {
        const visited = new Set();
        const queue = [{ col: from.col, row: from.row, cells: [{ col: from.col, row: from.row }] }];
        visited.add(`${from.col},${from.row}`);
        while (queue.length > 0) {
            const cur = queue.shift();
            if (cur.col === to.col && cur.row === to.row) return cur.cells;
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dc, dr] of dirs) {
                const nc = cur.col + dc, nr = cur.row + dr;
                const nk = `${nc},${nr}`;
                if (!this.dotMatrix.inside(nc, nr)) continue;
                if (visited.has(nk)) continue;
                // 排除集合：BFS 不可穿越这些格子（防止路径穿过 head 导致自环）
                if (excludeCells && excludeCells.has(nk)) continue;
                if (this.dotMatrix.getOccupant(nc, nr)) continue;
                visited.add(nk);
                queue.push({ col: nc, row: nr, cells: [...cur.cells, { col: nc, row: nr }] });
            }
        }
        return null;
    }

    // =========================================================================
    // _cellsToPath — 格子序列 → [{dir, count}]
    // =========================================================================
    _cellsToPath(cells) {
        const path = [];
        for (let i = 0; i < cells.length - 1; i++) {
            const dc = cells[i + 1].col - cells[i].col;
            const dr = cells[i + 1].row - cells[i].row;
            let dir;
            if (dc === 1) dir = 'right';
            else if (dc === -1) dir = 'left';
            else if (dr === 1) dir = 'down';
            else dir = 'up';
            if (path.length > 0 && path[path.length - 1].dir === dir) {
                path[path.length - 1].count++;
            } else {
                path.push({ dir, count: 1 });
            }
        }
        return path;
    }

    // =========================================================================
    // 居中定位
    // =========================================================================
    setPosition(x, y) {
        this.container.setPosition(x, y);
    }
}
