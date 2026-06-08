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
        // 点阵（Dot Matrix）— 用 Container 容器实现居中
        //
        // 【什么是 Container？】
        // Container 是一个"组"，把多个对象装在一起。
        // 里面的对象用相对坐标（相对于容器左上角），
        // 然后整个容器作为一个整体，设置它在场景中的绝对位置。
        //
        // 这样做的好处：
        //   不用手动算每个点的绝对坐标 → 容器放哪，点阵就整体到哪
        //
        // 【坐标系对比】
        //   场景绝对坐标  →  this.add.image(场景x, 场景y, 'dot')
        //   容器相对坐标  →  container.add(image(容器内x, 容器内y, 'dot'))
        //   容器位置      →  container.setPosition(场景x, 场景y)
        //
        //   COLS = 8 列（横向，X 轴短）
        //   ROWS = 16 行（纵向，Y 轴长）
        //   SPACING = 25 像素
        // =========================================================================
        const COLS = CONFIG.MATRIX.COLS;
        const ROWS = CONFIG.MATRIX.ROWS;
        const SPACING = CONFIG.MATRIX.SPACING;

        // 容器总尺寸
        const matrixW = (COLS - 1) * SPACING;
        const matrixH = (ROWS - 1) * SPACING;

        // 创建容器，初始位置随意（后面会设）
        const container = this.add.container(0, 0);

        // 向容器内添加点，坐标为相对于容器的偏移
        // 让点阵中心对齐容器原点 → 每个点的坐标偏移半个矩阵宽高
        for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
                const dot = this.add.image(
                    col * SPACING - matrixW / 2,   // 相对 X：居中偏移
                    row * SPACING - matrixH / 2,   // 相对 Y：居中偏移
                    'dot'
                );
                container.add(dot);
            }
        }

        // =========================================================================
        // 四个方向的箭头 — 共用一个纹理，靠旋转区分方向
        //
        // 箭头纹理默认指向右（→），setAngle() 顺时针旋转：
        //   → 0°      ↓ 90°      ← 180°      ↑ 270°（或 -90°）
        //
        // 每个箭头的尾巴卡在一个点上，尖尖卡在相邻点上
        // 中心坐标 = 尾巴和尖尖的中点（单位：格）
        //   → 右：中心 (col+0.5, row)
        //   ↓ 下：中心 (col, row+0.5)
        //   ← 左：中心 (col-0.5, row)
        //   ↑ 上：中心 (col, row-0.5)
        //
        // 四个箭头分散摆放，互不重叠
        // =========================================================================

        // 辅助：格坐标 → 容器内像素坐标（居中偏移已计入）
        const toX = (col) => col * SPACING - matrixW / 2;
        const toY = (row) => row * SPACING - matrixH / 2;

        // 方向 → 角度映射
        const DIR = {
            right: { dx: 1, dy: 0, angle: 0   },
            down:  { dx: 0, dy: 1, angle: 90  },
            left:  { dx: -1, dy: 0, angle: 180 },
            up:    { dx: 0, dy: -1, angle: -90 },
        };

        // =========================================================================
        // isInside() 测试：三条线，分别全内 / 全外 / 部分外
        // =========================================================================

        // ---- 测试：一条直线 + 前进/后退按钮 ----
        const testLine = new ArrowLineNew(this, container, 3, 3, [
            { dir: 'right', count: 3 },
            { dir: 'down',  count: 2 },
        ], toX, toY, DIR, '1');

        // 目标点：尾巴(3,3)走向右，后退向左，左两格=(1,3)
        const targetCol = 1, targetRow = 3;
        const targetDot = this.add.image(toX(targetCol), toY(targetRow), 'dot')
            .setTintFill(0xff4444).setScale(2);
        container.add(targetDot);

        // 后退按钮
        const btnRet = this.add.text(width / 2, height - 40, '◀ 后退', {
            fontSize: '22px',
            color: '#ff4444',
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 3,
        }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(100);
        btnRet.on('pointerdown', () => testLine.retreat(targetCol, targetRow));
        btnRet.on('pointerover', () => btnRet.setColor('#ff8888'));
        btnRet.on('pointerout', () => btnRet.setColor('#ff4444'));

        // 整个容器放合适位置
        container.setPosition(width / 2, height / 2 + 20);

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

