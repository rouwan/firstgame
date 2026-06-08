/**
 * HomeScene — 游戏首页场景
 *
 * 【什么是场景（Scene）？】
 * 场景是 Phaser 的核心概念，可以理解为游戏的"页面"或"屏幕"。
 * 每个场景有自己独立的生命周期，不同场景之间可以互相跳转。
 * 常见场景举例：加载页、主菜单、游戏关卡、结算页、设置页。
 *
 * 【场景的四个生命周期方法】
 * 1. constructor() — 创建阶段，只执行一次
 * 2. init()       — 初始化阶段，场景启动时执行（可选，本场景未使用）
 * 3. preload()    — 预加载阶段，加载外部资源（可选，本场景未使用）
 * 4. create()     — 创建阶段，搭建场景内容（放置精灵、文字、按钮等）
 * 5. update()     — 每帧更新，写游戏逻辑的地方（可选，本场景未使用）
 *
 * 执行顺序：constructor → init → preload → create → (每帧 update)
 *
 * 【场景跳转】
 * - this.scene.start('场景key')  → 切换到目标场景（当前场景会被关闭）
 * - this.scene.launch('场景key') → 启动目标场景并叠加在当前场景之上
 * - this.scene.stop()            → 关闭当前场景
 */
class HomeScene extends Phaser.Scene {

    /**
     * constructor() — 构造函数
     * 场景被 new 的时候调用，只执行一次
     *
     * super({ key: 'HomeScene' }) 中：
     *   key 是场景的唯一标识符，其他场景通过这个 key 来跳转
     *   key 在全局必须唯一，推荐用场景类名保持一致
     */
    constructor() {
        super({ key: 'HomeScene' });
    }

    /**
     * create() — 场景创建
     * 场景启动后执行（只执行一次），在这里搭建场景的所有内容
     *
     * this.cameras.main 是当前场景的主摄像机
     *   - width  / height 分别是摄像机可视区域的宽高（等于 config 中设置的 800×600）
     *   - fadeIn()  让画面从指定颜色渐变到透明（入场淡入效果）
     */
    create() {
        // 解构赋值：把 width 和 height 从 cameras.main 中取出，方便后续使用
        const { width, height } = this.cameras.main;

        // =========================================================================
        // 程序化生成按钮纹理
        //
        // 因为没有使用外部图片，所以用 Graphics 画一个按钮纹理缓存起来。
        // 纹理（Texture）是 Phaser 中所有可显示对象的"贴图"，
        // Image、Sprite 等对象都需要一个纹理来渲染。
        //
        // this.textures.exists('btn')
        //   - 检查名为 'btn' 的纹理是否已存在（避免重复生成）
        //
        // this.add.graphics()
        //   - 创建一个 Graphics 对象（矢量绘图工具），添加到当前场景
        //   - Graphics 适合画简单图形：矩形、圆形、线条、多边形等
        //
        // g.fillStyle(0x4488ff, 1)
        //   - 设置填充颜色和透明度
        //   - 0x4488ff 是十六进制颜色（蓝色系）
        //   - 1 是 alpha 值，范围 0（全透明）~1（完全不透明）
        //
        // g.fillRoundedRect(x, y, w, h, radius)
        //   - 画一个圆角矩形，左上角坐标 (0, 0)，宽 200，高 60，圆角半径 12
        //
        // g.generateTexture('btn', 200, 60)
        //   - 把 Graphics 画的内容"烘焙"成一张纹理，缓存到纹理管理器中
        //   - 之后可以用 this.add.image(x, y, 'btn') 来复用，不用每次重画
        //
        // g.destroy()
        //   - 销毁 Graphics 对象，释放内存（纹理已经生成了，不再需要它）
        // =========================================================================
        if (!this.textures.exists('btn')) {
            const g = this.add.graphics();
            g.fillStyle(CONFIG.TEX.BTN_COLOR, 1);
            g.fillRoundedRect(0, 0, CONFIG.TEX.BTN_W, CONFIG.TEX.BTN_H, CONFIG.TEX.BTN_RADIUS);
            g.generateTexture('btn', CONFIG.TEX.BTN_W, CONFIG.TEX.BTN_H);
            g.destroy();
        }

        // =========================================================================
        // 生成方块纹理
        //
        // g.fillRect(x, y, w, h) → 画一个直角矩形
        //
        // 这个纹理会在 GameScene 中使用：this.add.image(x, y, 'block')
        // =========================================================================
        if (!this.textures.exists('block')) {
            const g = this.add.graphics();
            const s = CONFIG.TEX.BLOCK_SIZE;
            g.fillStyle(CONFIG.TEX.BLOCK_COLOR, 1);
            g.fillRect(0, 0, s, s);
            g.generateTexture('block', s, s);
            g.destroy();
        }

        // =========================================================================
        // 生成圆纹理
        //
        // g.fillCircle(x, y, radius) → 画一个实心圆
        //   (x, y) 是圆心，radius 是半径
        //
        // 这个纹理会在 GameScene 中使用：this.add.image(x, y, 'circle')
        // =========================================================================
        if (!this.textures.exists('circle')) {
            const g = this.add.graphics();
            const r = CONFIG.TEX.CIRCLE_RADIUS;
            g.fillStyle(CONFIG.TEX.CIRCLE_COLOR, 1);
            g.fillCircle(r, r, r);
            g.generateTexture('circle', r * 2, r * 2);
            g.destroy();
        }

        // =========================================================================
        // 生成圆点纹理 — 用于点阵
        // =========================================================================
        if (!this.textures.exists('dot')) {
            const g = this.add.graphics();
            const r = CONFIG.TEX.DOT_RADIUS;
            g.fillStyle(CONFIG.TEX.DOT_COLOR, 1);
            g.fillCircle(r, r, r);
            g.generateTexture('dot', r * 2, r * 2);
            g.destroy();
        }

        // =========================================================================
        // 生成箭头纹理 — 指向右，长度 = 点阵一格
        //
        //   尾巴(0)  ────杆────  ▶ 尖尖(SPACING)
        //   |←————  SPACING=25px  ————→|
        //
        // 纹理尺寸：SPACING × 10（宽 × 高）
        //   杆：细长矩形，从 x=0 到 x=18
        //   尖：三角形，右端点 (SPACING, 高/2)
        // =========================================================================
        if (!this.textures.exists('arrow')) {
            const g = this.add.graphics();
            const len = CONFIG.MATRIX.SPACING;   // 箭头总长 = 一格
            const h = 10;                         // 纹理高度
            const shaftW = len - 7;               // 杆的宽度（留 7px 给箭头尖）
            const shaftH = 4;                     // 杆的粗细
            const shaftY = (h - shaftH) / 2;      // 杆的 y（垂直居中）

            g.fillStyle(CONFIG.TEX.ARROW_COLOR, 1);

            // 杆（矩形）
            g.fillRect(0, shaftY, shaftW, shaftH);

            // 尖（三角形）：三个顶点 → 指向右
            g.fillTriangle(
                shaftW, 0,           // 左上
                shaftW, h,           // 左下
                len, h / 2           // 右尖端
            );

            g.generateTexture('arrow', len, h);
            g.destroy();
        }

        // =========================================================================
        // 生成线段纹理 — 无箭头，就是一根直杆，长度 = 点阵一格
        //
        //    |←————  SPACING=25px  ————→|
        //    ═══════════════════════════  纯杆，没尖
        //
        // 尺寸和箭头纹理一致（SPACING × 10），只是不画三角尖
        // =========================================================================
        if (!this.textures.exists('segment')) {
            const g = this.add.graphics();
            const len = CONFIG.MATRIX.SPACING;
            const h = 10;
            const shaftH = 4;
            const shaftY = (h - shaftH) / 2;

            g.fillStyle(CONFIG.TEX.SEGMENT_COLOR, 1);
            g.fillRect(0, shaftY, len, shaftH);  // 只画杆，不画三角

            g.generateTexture('segment', len, h);
            g.destroy();
        }

        // =========================================================================
        // 背景
        //
        // this.add.rectangle(x, y, w, h, color)
        //   - 绘制一个纯色矩形
        //   - (x, y) 是矩形中心点的坐标
        //   - 颜色 0x1a1a2e 是深蓝紫色
        //   - 因为这是第一个添加的对象，所以它在最底层（Phaser 按添加顺序堆叠）
        // =========================================================================
        this.add.rectangle(width / 2, height / 2, width, height, CONFIG.SCENE.HOME_BG);

        // =========================================================================
        // 游戏标题
        //
        // this.add.text(x, y, '文字内容', style对象)
        //   - 在场景中添加文字
        //   - .setOrigin(0.5) 把锚点设为中心，这样 (x, y) 就是文字的正中心
        //     - 0 是左上角，0.5 是中心，1 是右下角
        //     - 不设置的话默认 (0, 0)，即 (x, y) 是文字的左上角
        // =========================================================================
        this.add.text(width / 2, height / 2 - 120, '🎮 我的游戏', {
            fontSize: '48px',
            color: '#ffffff',
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold',
        }).setOrigin(0.5);

        // 副标题 — 颜色较浅，字号较小，衬托主标题
        this.add.text(width / 2, height / 2 - 60, 'Phaser 3 游戏 Demo', {
            fontSize: '18px',
            color: '#aaaaaa',
            fontFamily: 'Arial, sans-serif',
        }).setOrigin(0.5);

        // =========================================================================
        // 「开始游戏」按钮
        //
        // this.add.image(x, y, '纹理key')
        //   - 添加一张图片（这里用的是上面生成的 'btn' 纹理）
        //   - .setInteractive() 让这个图片可以响应鼠标/触摸事件
        //   - { useHandCursor: true } 鼠标悬停时显示手型光标
        //
        // 按钮文字叠加在按钮图片之上（因为文字在图片之后添加，所以在上面一层）
        // =========================================================================
        const startBtn = this.add.image(width / 2, height / 2 + 40, 'btn')
            .setInteractive({ useHandCursor: true });
        const startText = this.add.text(width / 2, height / 2 + 40, '开始游戏', {
            fontSize: '24px',
            color: '#ffffff',
            fontFamily: 'Arial, sans-serif',
        }).setOrigin(0.5);

        // ---------- 按钮交互事件 ----------

        // pointerover — 鼠标指针移入按钮区域时触发
        // setTint(color)    给纹理叠加一层颜色（这里让按钮变亮）
        // setScale(1.05)    放大到 1.05 倍（微放大效果）
        startBtn.on('pointerover', () => {
            startBtn.setTint(0x66aaff);
            startBtn.setScale(1.05);
            startText.setScale(1.05);
        });

        // pointerout — 鼠标指针移出按钮区域时触发
        // clearTint()  清除颜色叠加
        // setScale(1)   恢复原始大小
        startBtn.on('pointerout', () => {
            startBtn.clearTint();
            startBtn.setScale(1);
            startText.setScale(1);
        });

        // pointerdown — 鼠标按下/手指触摸时触发
        // this.scene.start('GameScene')  跳转到游戏主场景
        //   这会关闭当前的 HomeScene，启动 GameScene
        startBtn.on('pointerdown', () => {
            this.scene.start('GameScene');
        });

        // =========================================================================
        // 底部提示文字 — 告诉玩家可以点击按钮
        // 颜色 #666666 是很暗的灰色，不太显眼，适合辅助性提示
        // =========================================================================
        this.add.text(width / 2, height - 40, '点击按钮开始游戏', {
            fontSize: '14px',
            color: '#666666',
            fontFamily: 'Arial, sans-serif',
        }).setOrigin(0.5);

        // =========================================================================
        // 入场淡入动画
        //
        // cameras.main.fadeIn(duration, r, g, b)
        //   - duration: 动画持续时间（毫秒），500 = 0.5 秒
        //   - r, g, b: 起始颜色分量，0 0 0 = 黑色
        //   - 效果：画面在 0.5 秒内从黑色渐变到正常画面
        //   - 搭配音效会很有氛围
        // =========================================================================
        this.cameras.main.fadeIn(500, 0, 0, 0);
    }
}
