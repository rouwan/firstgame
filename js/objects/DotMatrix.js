/**
 * DotMatrix — 点阵
 *
 * 管理所有格点的占用状态。是格点占用的唯一真相源。
 *
 * 每条箭头线通过 DotMatrix 来注册/释放/查询格点：
 *   - 创建时注册自己覆盖的格点
 *   - 飞行时查询新头部所属格点是否被其他线占用
 *   - 每步飞行释放旧尾格点、占用新头格点
 *   - 销毁时释放所有格点
 */

class DotMatrix {

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

        // 坐标映射（与 ArrowMatrix 共享的算法）
        const matrixW = (cols - 1) * spacing;
        const matrixH = (rows - 1) * spacing;
        this.toX = (col) => col * spacing - matrixW / 2;
        this.toY = (row) => row * spacing - matrixH / 2;

        // 格点网格：grid[row][col] = { image, occupier }
        this.grid = [];
        for (let row = 0; row < rows; row++) {
            this.grid[row] = [];
            for (let col = 0; col < cols; col++) {
                this.grid[row][col] = {
                    image: null,     // Phaser.Image
                    occupier: null,  // ArrowLine | null — 唯一真相源
                };
            }
        }
    }

    // =========================================================================
    // 绘制所有格点（替代 ArrowMatrix.drawDots 的职责）
    // =========================================================================
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
    // 占用一个格点
    //
    // 如果已被同一线占用 → 无操作（幂等）
    // 如果已被其他线占用 → 返回冲突
    // 如果空闲 → 占用成功
    //
    // @returns {{ ok: true }} | {{ ok: false, conflict: ArrowLine }}
    // =========================================================================
    occupy(col, row, line) {
        // 棋盘外的点不管理
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
            return { ok: true };
        }
        const cell = this.grid[row][col];
        if (cell.occupier && cell.occupier !== line) {
            return { ok: false, conflict: cell.occupier };
        }
        cell.occupier = line;
        return { ok: true };
    }

    // =========================================================================
    // 释放一个格点（仅当占用者是该线时才释放）
    // =========================================================================
    release(col, row, line) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
            return;
        }
        const cell = this.grid[row][col];
        if (cell.occupier === line) {
            cell.occupier = null;
        }
    }

    // =========================================================================
    // 查询
    // =========================================================================

    /** 返回占用者引用；空闲返回 null */
    getOccupant(col, row) {
        if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) {
            return null;
        }
        return this.grid[row][col].occupier;
    }

    /** 是否被占用 */
    isOccupied(col, row) {
        return this.getOccupant(col, row) !== null;
    }

    /** 是否在网格范围内 */
    inside(col, row) {
        return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
    }
}
