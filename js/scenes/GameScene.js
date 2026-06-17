/**
 * GameScene — 游戏主场景
 *
 * 这是核心游戏逻辑所在的场景。目前是空模板，留好了结构等你填充。
 *
 * 【场景生命周期复习】
 * constructor → init(可选) → preload(可选) → create → update(每帧)
 *
 * 【场景跳转回到首页】
 * - 点击「← 返回」文字按钮
 * - 按下 ESC 键
 */
class GameScene extends Phaser.Scene {

    /**
     * constructor() — 构造函数
     * 注册场景的唯一标识符 key
     */
    constructor() {
        super({ key: 'GameScene' });
    }

    /**
     * create() — 搭建场景内容（只执行一次）
     *
     * 在这里创建：
     * - 背景、地图
     * - 玩家角色
     * - 敌人
     * - UI / HUD
     * - 输入绑定
     * - 音效
     *
     * 【Phaser 坐标体系】
     *
     *   x 轴 → 从左到右（0 ∼ 800）
     *   y 轴 → 从上到下（0 ∼ 600）  ← 屏幕坐标系 y 向下为正！
     *   没有真正的 z 轴（Phaser 是 2D 引擎）
     *
     *   "前后"（垂直屏幕方向）用两个机制模拟：
     *
     *   1. 添加顺序（隐式 z）
     *      后 add() 的对象自动盖在先 add() 的上面
     *      就像在桌上叠纸 — 后放的纸在上面
     *
     *   2. setDepth(数字)（显式 z）
     *      给对象标一个深度值，值越大越靠前
     *      例如：背景.setDepth(0)  角色.setDepth(10)  UI.setDepth(100)
     *      用了 setDepth 后，添加顺序不再影响层级
     *
     *   类比 3D：
     *      x = 左右
     *      y = 上下
     *      z = 垂直屏幕，指向观众 ← 你的理解完全正确！
     *      值越大 = 离观众越近 = 盖住值小的东西
     */
    create() {
        const { width, height } = this.cameras.main;

        // =========================================================================
        // 背景
        // =========================================================================
        this.add.rectangle(width / 2, height / 2, width, height, CONFIG.SCENE.GAME_BG);

        // =========================================================================
        // HUD 顶部信息栏
        // =========================================================================
        this.add.rectangle(width / 2, 30, width, 60, 0x000000, 0.5);

        this.add.text(width / 2, 30, '游戏主场景', {
            fontSize: '20px',
            color: '#ffffff',
            fontFamily: 'Arial, sans-serif',
        }).setOrigin(0.5);

        // =========================================================================
        // 返回按钮
        // =========================================================================
        const backBtn = this.add.text(80, 30, '← 返回', {
            fontSize: '18px',
            color: '#ff8844',
            fontFamily: 'Arial, sans-serif',
        })
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });

        backBtn.on('pointerover', () => backBtn.setColor('#ffaa66'));
        backBtn.on('pointerout', () => backBtn.setColor('#ff8844'));
        backBtn.on('pointerdown', () => {
            this.scene.start('HomeScene');
        });

        // =========================================================================
        // 实验：点阵 + 单线生成按钮
        // =========================================================================
        const matrix = new ArrowMatrixNew(this, CONFIG.MATRIX.COLS, CONFIG.MATRIX.ROWS, CONFIG.MATRIX.SPACING);
        matrix.drawDots();
        matrix.setPosition(width / 2, height / 2 + 20);

        // 五阶段生成：1→2→3→2→4→结束
        const sequence = [1, 2, 3, 2, 4];
        let seqIdx = 0;
        let genDone = false;
        const names = { 1: '阶段1: 边界线', 2: '阶段2: 前序线', 3: '阶段3: 向内线', 4: '阶段4: 清场' };
        const genBtn = this.add.text(width / 2, height - 20, names[sequence[0]] + ' (0)', {
            fontSize: '18px', color: '#ffffff', backgroundColor: '#4488ff',
            padding: { x: 20, y: 10 }, fontFamily: 'Arial, sans-serif',
        })
            .setOrigin(0.5, 1)
            .setInteractive({ useHandCursor: true })
            .setDepth(100);

        genBtn.on('pointerdown', () => {
            if (genDone) return;
            const phase = sequence[seqIdx];
            const type = matrix.generateNextBatch(phase);
            if (!type) {
                genDone = true;
                genBtn.setText('生成结束').setColor('#888888')
                    .setStyle({ backgroundColor: '#333333' }).disableInteractive();
                return;
            }
            seqIdx++;
            if (seqIdx >= sequence.length) {
                genDone = true;
                genBtn.setText('生成结束').setColor('#888888')
                    .setStyle({ backgroundColor: '#333333' }).disableInteractive();
                return;
            }
            genBtn.setText(names[sequence[seqIdx]] + ` (${matrix.lines.length})`);
        });

        // 下载 log
        const dumpBtn = this.add.text(width / 2, height - 56, '📋 下载Log', {
            fontSize: '14px', color: '#ffffff', backgroundColor: '#555555',
            padding: { x: 12, y: 6 }, fontFamily: 'Arial, sans-serif',
        })
            .setOrigin(0.5, 1)
            .setInteractive({ useHandCursor: true })
            .setDepth(100);

        dumpBtn.on('pointerdown', () => {
            const report = matrix.dump();
            if (!report) return;
            const json = JSON.stringify(report, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const now = new Date();
            const localStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0')
                + 'T' + String(now.getHours()).padStart(2,'0') + '-' + String(now.getMinutes()).padStart(2,'0') + '-' + String(now.getSeconds()).padStart(2,'0');
            a.download = 'line-gen-' + localStr + '.log';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });

        // =========================================================================
        // ESC 键返回首页
        // =========================================================================
        this.input.keyboard.on('keydown-ESC', () => {
            this.scene.start('HomeScene');
        });

        // =========================================================================
        // 入场淡入动画
        // =========================================================================
        this.cameras.main.fadeIn(500, 0, 0, 0);
    }

    /**
     * update() — 游戏主循环（每帧调用一次）
     *
     * 【什么是"每帧"？】
     * 游戏通常以 60 FPS（每秒 60 帧）运行，意味着 update() 每秒被调用 60 次。
     * 这里写所有需要持续更新的逻辑：
     *   - 玩家移动
     *   - 敌人 AI
     *   - 碰撞检测（如果启用了物理引擎，碰撞会自动处理，这里只需写响应逻辑）
     *   - 计时器 / 倒计时
     *   - 动画更新
     *
     * 【注意】
     * 如果当前场景不需要每帧更新（比如静态菜单页），可以省略 update 方法
     * Phaser 会自动跳过，节省性能
     */
    update() {
        // TODO: 在这里写游戏主循环逻辑
    }
}

/**
 * showPopup — 弹出提示文字（向上飘 + 淡出 + 自动销毁）
 *
 * 这不是纹理，是 Text 对象。每次调用都动态创建一个新文字，
 * 动画结束后自动销毁，不会常驻内存。
 *
 * 【参数】
 *   scene — 当前场景（传 this）
 *   x, y  — 弹出位置
 *   text  — 要显示的文字，如 '方块'、'圆'、'+5'
 *
 * 【tweens（补间动画）】
 *   this.tweens.add({ ... }) 是 Phaser 的动画系统
 *   targets         — 要对哪个对象做动画
 *   y: y - 30       — 目标 y 坐标（向上飘 30 像素）
 *   alpha: 0        — 目标透明度（1 → 0 淡出）
 *   duration: 600   — 动画时长 600 毫秒
 *   ease: 'Power2'  — 缓动函数，Power2 是先快后慢
 *   onComplete      — 动画结束后的回调：销毁文字对象
 */
function showPopup(scene, x, y, text) {
    const popup = scene.add.text(x, y, text, {
        fontSize: '28px',
        color: '#ffdd44',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
    }).setOrigin(0.5);

    scene.tweens.add({
        targets: popup,
        y: y - 30,             // 向上飘 30 像素
        alpha: 0,              // 淡出
        duration: 600,         // 0.6 秒
        ease: 'Power2',        // 先快后慢
        onComplete: () => popup.destroy(),
    });
}

