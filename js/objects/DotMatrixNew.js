/**
 * DotMatrixNew — 点阵（新版）
 *
 * 管理所有格点的占用状态。每个格点记录属于哪条箭头线（或空置）。
 * 提供随机取可用点、邻居查询等接口，供箭头线生成算法使用。
 */

class DotMatrixNew {

    /**
     * @param {Phaser.Scene} scene
     * @param {number} cols    - 列数
     * @param {number} rows    - 行数
     * @param {number} spacing - 点间距（像素）
     */
    constructor(scene, cols, rows, spacing) {
        this.scene = scene;
        this.cols = cols;
        this.rows = rows;

        // 坐标映射：格坐标 → 像素坐标（以矩阵中心为原点）
        const matrixW = (cols - 1) * spacing;
        const matrixH = (rows - 1) * spacing;
        this.toX = (col) => col * spacing - matrixW / 2;
        this.toY = (row) => row * spacing - matrixH / 2;

        // 格点网格：grid[row][col] = { image, owner }
        //   image  — Phaser Image（dot 纹理）
        //   owner  — ArrowLine | null（唯一真相源）
        this.grid = [];
        for (let row = 0; row < rows; row++) {
            this.grid[row] = [];
            for (let col = 0; col < cols; col++) {
                this.grid[row][col] = { image: null, owner: null };
            }
        }

        // 区域过滤器：非 null 时 getAvailablePoints/Neighbors 只返回区域内格点
        this._regionFilter = null;  // Set of "col,row" strings
        // 射线预留：本轮次前序线的射线经过的空格，后序线不得占用
        this._reservedSet = null;   // Set of "col,row" strings
    }

    // =========================================================================
    // 绘制
    // =========================================================================

    /**
     * 在所有格点位置创建圆点图像，加入指定 container
     */
    draw(container) {
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const img = this.scene.add.image(this.toX(col), this.toY(row), 'dot');
                container.add(img);
                this.grid[row][col].image = img;
            }
        }
    }

    // =========================================================================
    // 查询
    // =========================================================================

    /** 是否在网格范围内 */
    inside(col, row) {
        return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
    }

    /** 返回占用者；空闲返回 null */
    getOccupant(col, row) {
        if (!this.inside(col, row)) return null;
        return this.grid[row][col].owner;
    }

    /** 返回所有未被占用的格点（排除预留） */
    getAvailablePoints() {
        const points = [];
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const key = `${col},${row}`;
                const inRegion = !this._regionFilter || this._regionFilter.has(key);
                const notReserved = !this._reservedSet || !this._reservedSet.has(key);
                if (!this.grid[row][col].owner && inRegion && notReserved) {
                    points.push({ col, row });
                }
            }
        }
        return points;
    }

    /** 随机返回一个未被占用的格点，没有则返回 null */
    getRandomAvailablePoint() {
        const available = this.getAvailablePoints();
        if (available.length === 0) return null;
        return available[Math.floor(Math.random() * available.length)];
    }

    /**
     * 返回指定格点在四方向上的空闲邻居
     * @returns {Array<{col, row, dir}>}
     */
    getAvailableNeighbors(col, row) {
        const dirs = [
            { dc: 1,  dr: 0,  dir: 'right' },
            { dc: -1, dr: 0,  dir: 'left'  },
            { dc: 0,  dr: 1,  dir: 'down'  },
            { dc: 0,  dr: -1, dir: 'up'    },
        ];
        const results = [];
        for (const d of dirs) {
            const nc = col + d.dc;
            const nr = row + d.dr;
            const nk = `${nc},${nr}`;
            const inRegion = !this._regionFilter || this._regionFilter.has(nk);
            const notReserved = !this._reservedSet || !this._reservedSet.has(nk);
            if (this.inside(nc, nr) && inRegion && notReserved && !this.grid[nr][nc].owner) {
                results.push({ col: nc, row: nr, dir: d.dir });
            }
        }
        return results;
    }

    // =========================================================================
    // 占用 / 释放
    // =========================================================================

    /**
     * 占用一个格点
     * 同一线重复占用 → 幂等（无操作）
     * 已被其他线占用 → 返回 { ok: false, conflict }
     */
    occupy(col, row, line) {
        if (!this.inside(col, row)) return { ok: false };
        const cell = this.grid[row][col];
        if (cell.owner && cell.owner !== line) {
            return { ok: false, conflict: cell.owner };
        }
        cell.owner = line;
        return { ok: true };
    }

    /** 释放格点（仅当占用者是该线时才释放） */
    release(col, row, line) {
        if (!this.inside(col, row)) return;
        const cell = this.grid[row][col];
        if (cell.owner === line) {
            cell.owner = null;
        }
    }

    // =========================================================================
    // getEmptyRegions — BFS 找所有空区域（四方向连通分量）
    // @returns {Array<{cells: [{col,row},...], size: number}>}
    // =========================================================================
    getEmptyRegions() {
        const visited = new Set();
        const regions = [];

        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                const key = `${col},${row}`;
                if (visited.has(key)) continue;
                if (this.grid[row][col].owner) continue;
                // 区域过滤
                if (this._regionFilter && !this._regionFilter.has(key)) continue;

                const queue = [{ col, row }];
                const cells = [];
                while (queue.length > 0) {
                    const cur = queue.shift();
                    const ck = `${cur.col},${cur.row}`;
                    if (visited.has(ck)) continue;
                    visited.add(ck);
                    cells.push({ col: cur.col, row: cur.row });

                    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
                    for (const [dc, dr] of dirs) {
                        const nc = cur.col + dc;
                        const nr = cur.row + dr;
                        const nk = `${nc},${nr}`;
                        // 区域过滤 + 常规检查
                        if (this._regionFilter && !this._regionFilter.has(nk)) continue;
                        if (this.inside(nc, nr) && !visited.has(nk) && !this.grid[nr][nc].owner) {
                            queue.push({ col: nc, row: nr });
                        }
                    }
                }

                regions.push({ cells, size: cells.length });
            }
        }

        regions.sort((a, b) => b.size - a.size);
        return regions;
    }
}
