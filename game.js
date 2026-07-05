// 7 种基础冻鱼块形状。
// 每个 [x, y] 表示一个小方格在局部网格里的位置，4 个坐标组成一个整体冻鱼块。
const FISH_SHAPES = [
  { name: "O", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { name: "Z", cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { name: "S", cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { name: "T", cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  { name: "L", cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  { name: "J", cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  { name: "I", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
];

class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");

    /*
      伪物理核心：
      1. Matter 负责当前 falling 砖块的旋转和碰撞，但下落速度由游戏逻辑固定控制。
      2. 车和已落地砖块都不参与真实碰撞求解，只作为“支持面”被手动检测。
      3. falling -> landed 的瞬间，会吸附到支撑面并做一次穿透修正。
      4. landed 之后砖块不再互相施加碰撞力，静止时只表现为重力和支持力平衡。
      5. 车上的相连砖块会临时组成 cargo group，跟随小车并在急转时产生轻微水平摆动。
    */

    this.car = null;
    this.carParts = [];
    this.carDecorParts = [];
    this.carWidth = 300;
    this.carBaseHeight = 24;
    this.carRailWidth = 32;
    this.carRailHeight = 90;
    this.carCarrierOffset = 24;
    this.carCarrierHalfWidth = 9;
    this.fishDepth = 30;
    this.carDepth = 90;
    // 目前其他逻辑只需要判断“车厢底座”的高度，所以 carHeight 仍然代表底部平台高度。
    this.carHeight = this.carBaseHeight;
    this.carY = 520;
    this.targetX = 0;
    // 决定车速
    this.targetMoveSpeed = 180;
    this.carSmoothing = 0.33;
    this.carNoFriction = 0;
    this.landedNoFriction = 0.42;
    // 决定车厢在急转时的轻微摆动幅度
    this.inputTurnWindowMs = 100;
    this.lastNonZeroInputDirection = 0;
    this.lastNonZeroInputTime = -Infinity;
    this.shakeForceDirection = 0;
    this.shakeForceTimerMs = 0;
    this.shakeForceDurationMs = 50;
    this.shakeForce = 0.004;
    this.iceShakeForceScale = 0.25;

    // fishDepth 在这里既作为鱼块单格边长，也作为鱼块显示层级。
    // 每个冻鱼小格占用 fishDepth x fishDepth，白边画在格子内部，不改变实际尺寸。
    this.fishCellSize = this.fishDepth;
    this.fishVisualSize = this.fishDepth;
    this.fishPalette = [0x62cfc8, 0x8e76d8, 0x72a9e6, 0x74c694, 0xc886c9];
    // 控制多少个普通鱼块后出现一个冰块，避免冰块过于频繁。
    this.iceBlockMinFishInterval = 4;
    this.iceBlockMaxFishInterval = 6;
    this.normalFishUntilNextIceBlock = 0;
    this.iceBlockColor = 0x174ea6;
    // 冻结速度控制
    this.fishFreezeDelayMs = 15000;
    this.iceFreezeDelayMs = 2000;
    this.freezeContactGraceMs = 90;
    this.freezeMinContactRatio = 0.45;
    this.freezeSurfaceTolerance = 4;
    this.freezeParallelAngleTolerance = 0.12;
    this.freezeStablePositionTolerance = 1.2;
    this.freezeStableAngleTolerance = 0.035;
    this.freezeMaxRelativeStep = 1.4;
    this.freezeMaxAngularSpeed = 0.08;
    this.fallingDensity = 0.0014;
    // 下落速度控制
    this.fallingSpeed = 0.6;
    this.fastDropSpeed = 3.6;

    this.spawnTracks = [];
    this.currentSpawnIndex = 0;
    this.spawnDelayMs = 1000;
    this.isSpawnScheduled = false;
    this.nextSpawnEvent = null;
    this.spawnBeam = null;
    this.spawnBeamWidth = 44;
    this.currentSpawnBeamWidth = this.spawnBeamWidth;
    this.currentSpawnBeamCenterOffsetX = 0;
    this.currentSpawnX = 0;

    this.currentFish = null;
    this.landedPieces = [];
    this.frozenPieces = [];
    this.pendingFlatFreezes = new Map();
    this.nextCargoPieceId = 1;
    this.cargoSwaySpring = 0.045;
    this.cargoSwayDamping = 0.72;
    this.cargoMaxSwayOffset = 3;
    this.cargoConnectionTolerance = 3;
    this.cargoOverlapPadding = 0.9;

    // 伪物理落地参数。
    // landingSnapTolerance 越大，越不容易高速穿过支持面；太大会导致提前吸附。
    this.landingSnapTolerance = this.fishVisualSize;
    this.landingSeparation = 0.8;
    this.penetrationResolvePasses = 6;
    this.pseudoLandingExtraTolerance = 5;
    this.supportMinOverlapRatio = 0.45;

    this.lastCarMoveX = 0;

    this.rotateButton = null;
    this.dropButton = null;
    this.uiCamera = null;
    this.uiObjects = [];
    this.worldObjects = [];
    this.backdropBackground = null;
    this.snowBase = null;
    this.snowEdge = null;
    this.uiPanelHeight = 92;
    this.gameViewHeight = 0;
    this.worldBottomY = 0;
    this.groundHeight = 52;
    this.isDropButtonHeld = false;
    this.keys = null;
    this.loadedFishCount = 0;
    this.loadLabel = null;
    this.maxLives = 5;
    this.lives = this.maxLives;
    this.lifeHearts = [];
    this.closeButton = null;
    this.restartButton = null;
    this.isPaused = false;
    this.isGameOver = false;
    this.pauseOverlayObjects = [];
    this.pauseLabel = null;

    // 控制镜头缩放和上移，保证鱼塔始终在可视范围内。
    this.cameraZoom = 1;
    this.minCameraZoom = 0.01;  // 最小缩小比例
    this.cameraTopPadding = 130;
    this.cameraZoomStartRatio = 0.60;  // 开始缩小比例
    this.cameraSmoothing = 0.08;
    this.stableTowerTopY = null;
    this.cameraHeightUpdateThreshold = 12;
  }

  resetRoundState() {
    if (this.nextSpawnEvent && typeof this.nextSpawnEvent.remove === "function") {
      this.nextSpawnEvent.remove(false);
    }

    this.car = null;
    this.carParts = [];
    this.carDecorParts = [];
    this.targetX = 0;
    this.lastNonZeroInputDirection = 0;
    this.lastNonZeroInputTime = -Infinity;
    this.shakeForceDirection = 0;
    this.shakeForceTimerMs = 0;
    this.currentSpawnIndex = 0;
    this.normalFishUntilNextIceBlock = this.getNextIceBlockInterval();
    this.isSpawnScheduled = false;
    this.nextSpawnEvent = null;
    this.spawnBeam = null;
    this.currentSpawnBeamWidth = this.spawnBeamWidth;
    this.currentSpawnBeamCenterOffsetX = 0;
    this.currentSpawnX = 0;
    this.currentFish = null;
    this.landedPieces = [];
    this.frozenPieces = [];
    this.pendingFlatFreezes = new Map();
    this.nextCargoPieceId = 1;
    this.lastCarMoveX = 0;
    this.rotateButton = null;
    this.dropButton = null;
    this.uiCamera = null;
    this.uiObjects = [];
    this.worldObjects = [];
    this.backdropBackground = null;
    this.snowBase = null;
    this.snowEdge = null;
    this.isDropButtonHeld = false;
    this.keys = null;
    this.loadedFishCount = 0;
    this.lives = this.maxLives;
    this.lifeHearts = [];
    this.closeButton = null;
    this.restartButton = null;
    this.isPaused = false;
    this.isGameOver = false;
    this.pauseOverlayObjects = [];
    this.pauseLabel = null;
    this.cameraZoom = 1;
    this.stableTowerTopY = null;

    if (this.time) {
      this.time.paused = false;
    }
  }

  // create 会在场景启动后执行一次，通常用于创建初始画面元素。
  create() {
    this.resetRoundState();
    this.createCameras();
    this.createBackdrop();
    this.createCarPlatform();
    this.updateTowerCamera(true);
    this.createFallingFishBlock();
    this.createInputControls();
    this.createControlPanel();
    this.createTopHud();
    this.createPauseOverlay();
    this.createDropButton();
    this.createRotateButton();
    this.createCollisionHandlers();
  }

  createCameras() {
    const mainCamera = this.cameras.main;

    // The gameplay area is only the blue viewport above the fixed UI panel.
    this.gameViewHeight = this.scale.height - this.uiPanelHeight;
    this.worldBottomY = this.gameViewHeight;
    this.carY = this.worldBottomY - this.carBaseHeight / 2;
    this.updateSpawnTracks();

    // 主相机只负责上方游戏区域，会随着鱼塔高度缩放和上移。
    mainCamera.setViewport(0, 0, this.scale.width, this.gameViewHeight);

    // UI 相机只负责底部操作区，不参与游戏世界缩放。
    // 两个相机各看各的对象，避免按钮跟着游戏相机抖动或变形。
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCamera.setScroll(0, 0);
  }

  // update 会在每一帧执行，适合放持续输入和移动逻辑。
  update(time, delta) {
    if (this.isPaused) {
      return;
    }

    const direction = this.getMoveDirection();

    this.syncCarToWorldBottom();
    this.updateTargetX(direction, delta);
    const carMoveX = this.applyCarSmoothing(delta);
    this.updateCarFrictionMode(direction);
    this.syncCarToWorldBottom();

    this.updateCarriedCargoGroups(delta, carMoveX);
    this.applyShakeForce(delta);
    this.updateStableFlatFreezes();
    this.cleanupFallenStackPieces();
    if (this.isPaused) {
      return;
    }

    this.applyFallingSpeedControl();
    this.detectCurrentFishPseudoLanding(delta);
    this.checkCurrentFishFallOut();
    this.updateTowerCamera();
    this.rememberCurrentFishPreviousBounds();
  }

  createBackdrop() {
    const topY = -3600;
    const backdropHeight = 4800 + this.gameViewHeight;
    const background = this.add.rectangle(
      this.scale.width / 2,
      topY + backdropHeight / 2,
      this.scale.width,
      backdropHeight,
      0xd6b363
    );
    const spawnBeam = this.add.rectangle(
      this.scale.width / 2,
      this.gameViewHeight / 2,
      this.spawnBeamWidth,
      this.gameViewHeight,
      0xffefb2,
      0.34
    );
    const snowBase = this.add.rectangle(
      this.scale.width / 2,
      this.worldBottomY - this.groundHeight / 2,
      this.scale.width + 80,
      this.groundHeight,
      0xf5fbff,
      1
    );
    const snowEdge = this.add.rectangle(
      this.scale.width / 2,
      this.worldBottomY - this.groundHeight + 2,
      this.scale.width + 80,
      4,
      0xdce8ef,
      1
    );
    const specks = [];

    background.setDepth(-120);
    spawnBeam.setDepth(-95);
    snowBase.setDepth(3);
    snowEdge.setDepth(4);
    this.backdropBackground = background;
    this.snowBase = snowBase;
    this.snowEdge = snowEdge;

    for (let i = 0; i < 140; i += 1) {
      const speck = this.add.circle(
        Phaser.Math.Between(12, this.scale.width - 12),
        Phaser.Math.Between(topY + 80, this.worldBottomY - this.groundHeight),
        Phaser.Math.FloatBetween(0.8, 1.9),
        0xfff7df,
        Phaser.Math.FloatBetween(0.35, 0.9)
      );
      speck.setDepth(-90);
      specks.push(speck);
    }

    this.spawnBeam = spawnBeam;
    this.updateGroundVisualBounds();
    this.registerWorldObject([background, spawnBeam, snowBase, snowEdge, ...specks]);
  }

  createCarPlatform() {
    const carX = this.scale.width / 2;
    const railY = this.carY - this.carBaseHeight / 2 - this.carRailHeight / 2;
    const leftRailX = carX - this.carWidth / 2 + this.carRailWidth / 2;
    const rightRailX = carX + this.carWidth / 2 - this.carRailWidth / 2;

    // 车由三块静态 Matter 矩形组成：底部车厢 + 左右护栏。
    // 伪物理版里这些 body 只用于坐标管理，真实支持力由 getCarSupportRects 提供。
    const base = this.add.rectangle(carX, this.carY, this.carWidth, this.carBaseHeight, 0x6a4227);
    const leftRail = this.add.rectangle(leftRailX, railY, this.carRailWidth, this.carRailHeight, 0x4a2a1a);
    const rightRail = this.add.rectangle(rightRailX, railY, this.carRailWidth, this.carRailHeight, 0x4a2a1a);

    base.setStrokeStyle(2, 0x2a1a12);
    leftRail.setStrokeStyle(2, 0x2a1a12);
    rightRail.setStrokeStyle(2, 0x2a1a12);

    [base, leftRail, rightRail].forEach((part) => {
      this.matter.add.gameObject(part, {
        isStatic: true,
        friction: this.carNoFriction,
        frictionStatic: this.carNoFriction,
        restitution: 0,
      });
      this.configureBodyForCollision(part.body);
      // 车是承载容器，视觉上应该压在鱼块前面。
      // 否则后生成的鱼块会盖住车厢，看起来像车被鱼堆淹没。
      part.setDepth(this.carDepth);
      part.setData("type", "car");
      part.setData("freezeObjectId", "car");
    });

    base.setData("carPartKind", "base");
    leftRail.setData("carPartKind", "rail");
    rightRail.setData("carPartKind", "rail");

    this.car = base;
    this.carParts = [base, leftRail, rightRail];
    this.createCarDecor(carX, this.carY);
    this.registerWorldObject(this.carParts);
    this.targetX = this.car.x;
    this.syncCarToWorldBottom();
  }

  createCarDecor(carX, baseY) {
    const wheelLeft = this.add.circle(carX - this.carWidth * 0.28, baseY + 6, 9, 0x33251f);
    const wheelRight = this.add.circle(carX + this.carWidth * 0.28, baseY + 6, 9, 0x33251f);
    const hubLeft = this.add.circle(wheelLeft.x, wheelLeft.y, 4, 0xc4b08e);
    const hubRight = this.add.circle(wheelRight.x, wheelRight.y, 4, 0xc4b08e);
    const leftCarrier = this.createCarrier(carX - this.carWidth / 2 - this.carCarrierOffset, baseY - 20);
    const rightCarrier = this.createCarrier(carX + this.carWidth / 2 + this.carCarrierOffset, baseY - 20);

    this.carDecorParts = [wheelLeft, wheelRight, hubLeft, hubRight, leftCarrier, rightCarrier];

    this.carDecorParts.forEach((part) => {
      part.setDepth(this.carDepth + 1);
      part.setData("offsetX", part.x - carX);
      part.setData("offsetY", part.y - baseY);
    });

    this.registerWorldObject(this.carDecorParts);
  }

  createCarrier(x, y) {
    const head = this.add.circle(0, -20, 8, 0x4f3326);
    const body = this.add.rectangle(0, 0, 16, 32, 0xc84a46);
    const scarf = this.add.rectangle(0, -8, 18, 5, 0x782f34);
    const carrier = this.add.container(x, y, [body, scarf, head]);

    return carrier;
  }

  syncCarToWorldBottom() {
    if (!this.car || this.carParts.length === 0) {
      return;
    }

    const MatterBody = Phaser.Physics.Matter.Matter.Body;
    const cartBottomY = this.worldBottomY;
    const baseY = cartBottomY - this.carBaseHeight / 2;
    const railY = baseY - this.carBaseHeight / 2 - this.carRailHeight / 2;
    const targetPositions = [
      { part: this.carParts[0], x: this.car.x, y: baseY },
      {
        part: this.carParts[1],
        x: this.car.x - this.carWidth / 2 + this.carRailWidth / 2,
        y: railY,
      },
      {
        part: this.carParts[2],
        x: this.car.x + this.carWidth / 2 - this.carRailWidth / 2,
        y: railY,
      },
    ];

    targetPositions.forEach(({ part, x, y }) => {
      if (!part || !part.body) {
        return;
      }

      MatterBody.setPosition(part.body, { x, y }, false);
    });

    this.carY = baseY;

    this.carDecorParts.forEach((part) => {
      part.setPosition(this.car.x + part.getData("offsetX"), baseY + part.getData("offsetY"));
    });
  }

  updateSpawnTracks() {
    const centerX = this.scale.width / 2;
    const trackSpacing = this.fishCellSize * 2;
    const trackCount = 5;
    const firstTrackOffset = -Math.floor(trackCount / 2) * trackSpacing;

    // 生成轨道围绕屏幕中线展开。
    // 这里不再写死 800 宽下的坐标，竖屏/横屏尺寸变化时都能保持在画面中间。
    this.spawnTracks = Array.from({ length: trackCount }, (value, index) => {
      const trackX = centerX + firstTrackOffset + index * trackSpacing;
      return Phaser.Math.Clamp(
        trackX,
        this.fishCellSize * 2,
        this.scale.width - this.fishCellSize * 2
      );
    });
  }

  createFallingFishBlock() {
    this.isSpawnScheduled = false;
    this.nextSpawnEvent = null;
    this.currentSpawnIndex += 1;

    const isIceBlock = this.shouldSpawnIceBlock();
    this.recordSpawnedPiece(isIceBlock);
    const shape = isIceBlock
      ? { name: "ICE", cells: [[0, 0]] }
      : Phaser.Utils.Array.GetRandom(FISH_SHAPES);
    const spawnX = Phaser.Utils.Array.GetRandom(this.spawnTracks);
    const layout = this.getShapeLayout(shape.cells);
    const spawnY = this.getFishSpawnY(layout);
    const fillColor = isIceBlock
      ? this.iceBlockColor
      : Phaser.Utils.Array.GetRandom(this.fishPalette);

    this.currentSpawnX = spawnX;
    this.currentSpawnBeamWidth = layout.boundsWidth;
    this.currentSpawnBeamCenterOffsetX = layout.boundsCenterX;
    this.positionSpawnBeam(spawnX);

    // 视觉上用 4 个纯色小矩形拼出冻鱼块；碰撞体仍使用同一批 cellOffsets。
    const cellRects = [];
    const frostMarks = [];
    const visualCells = [];

    layout.cellOffsets.forEach((offset, index) => {
      const cell = this.add.rectangle(
        offset.x,
        offset.y,
        this.fishVisualSize,
        this.fishVisualSize,
        fillColor,
        1
      );
      if (isIceBlock) {
        const marker = this.add.rectangle(
          offset.x,
          offset.y,
          this.fishVisualSize * 0.42,
          this.fishVisualSize * 0.42,
          0xffffff,
          0.95
        );

        marker.setAngle(45);
        marker.setVisible(false);
        cellRects.push(cell);
        frostMarks.push(marker);
        visualCells.push(cell, marker);
        return;
      }

      const crack = this.add.graphics();
      const half = this.fishVisualSize / 2;
      const wobble = index % 2 === 0 ? 1 : -1;

      crack.lineStyle(2, 0xf6ffff, 0.56);
      crack.beginPath();
      crack.moveTo(offset.x - half + 5, offset.y - 2 * wobble);
      crack.lineTo(offset.x - 2, offset.y + half - 5);
      crack.lineTo(offset.x + half - 4, offset.y + 1 * wobble);
      crack.strokePath();
      crack.lineStyle(1, 0xffffff, 0.38);
      crack.beginPath();
      crack.moveTo(offset.x - half + 4, offset.y - half + 7);
      crack.lineTo(offset.x + half - 6, offset.y - 3);
      crack.strokePath();
      crack.setVisible(false);
      cellRects.push(cell);
      frostMarks.push(crack);
      visualCells.push(cell, crack);
    });

    // Container 负责显示 4 个视觉小格。
    // Matter 碰撞体也按同一批 cellOffsets 创建，所以视觉和碰撞轮廓一致。
    const fish = this.add.container(spawnX, spawnY, visualCells);
    fish.setDepth(this.fishDepth);

    // 当前布局以真实小格质心为中心，后续旋转会围绕这个中心进行。
    fish.setData("shapeName", shape.name);
    fish.setData("pieceKind", isIceBlock ? "ice" : "fish");
    fish.setData("massCenterOffset", { x: 0, y: 0 });
    fish.setData("cellRects", cellRects);
    fish.setData("frostMarks", frostMarks);

    const collisionBody = this.createFishCollisionBodyFromCells(spawnX, spawnY, layout.cellOffsets);

    // Matter 里是 1 个整体 body，但它由 4 个矩形 part 组成真实碰撞轮廓。
    // 伪物理版里这个 body 只承担匀速下落、旋转、位置更新，不承担真实碰撞反作用。
    this.matter.add.gameObject(fish, collisionBody);
    this.applyFishMaterial(fish.body, {
      density: this.fallingDensity,
      friction: 0.85,
      frictionStatic: 1,
      frictionAir: 0.018,
      restitution: 0,
    });
    this.configureBodyForCollision(fish.body);
    this.registerWorldObject(fish);

    fish.setData("type", "fish");
    fish.setData("falling", true);
    fish.setData("landed", false);
    fish.setData("frozen", false);
    fish.setData("destroyed", false);
    fish.setData("spawnIndex", this.currentSpawnIndex);
    fish.setData("freezeObjectId", `piece-${this.nextCargoPieceId}`);
    this.nextCargoPieceId += 1;

    // 当前阶段只有一个正在下落的冻鱼块。
    // 状态拆成 falling / landed / frozen / destroyed，方便后续接正式流程时扩展。
    this.currentFish = {
      gameObject: fish,
      falling: true,
      landed: false,
      frozen: false,
      destroyed: false,
      pieceKind: isIceBlock ? "ice" : "fish",
      spawnIndex: this.currentSpawnIndex,
    };

    this.positionSpawnBeam(spawnX);
    this.rememberCurrentFishPreviousBounds();
  }

  getNextIceBlockInterval() {
    return Phaser.Math.Between(
      this.iceBlockMinFishInterval,
      this.iceBlockMaxFishInterval
    );
  }

  shouldSpawnIceBlock() {
    return this.normalFishUntilNextIceBlock <= 0;
  }

  recordSpawnedPiece(isIceBlock) {
    if (isIceBlock) {
      this.normalFishUntilNextIceBlock = this.getNextIceBlockInterval();
      return;
    }

    this.normalFishUntilNextIceBlock = Math.max(
      0,
      this.normalFishUntilNextIceBlock - 1
    );
  }

  getShapeLayout(cells) {
    const massCenterX = cells.reduce((sum, cell) => sum + cell[0], 0) / cells.length;
    const massCenterY = cells.reduce((sum, cell) => sum + cell[1], 0) / cells.length;
    const minCellX = Math.min(...cells.map((cell) => cell[0]));
    const maxCellX = Math.max(...cells.map((cell) => cell[0]));
    const minCellY = Math.min(...cells.map((cell) => cell[1]));
    const maxCellY = Math.max(...cells.map((cell) => cell[1]));
    const boundsLeft = (minCellX - massCenterX) * this.fishCellSize - this.fishVisualSize / 2;
    const boundsRight = (maxCellX - massCenterX) * this.fishCellSize + this.fishVisualSize / 2;
    const boundsTop = (minCellY - massCenterY) * this.fishCellSize - this.fishVisualSize / 2;
    const boundsBottom = (maxCellY - massCenterY) * this.fishCellSize + this.fishVisualSize / 2;

    // 以 4 个真实小格的质心作为局部原点。
    // 视觉小格和 Matter part 都使用这套 offset，所以旋转中心一致。
    return {
      boundsWidth: boundsRight - boundsLeft,
      boundsHeight: boundsBottom - boundsTop,
      boundsCenterX: (boundsLeft + boundsRight) / 2,
      boundsCenterY: (boundsTop + boundsBottom) / 2,
      cellOffsets: cells.map((cell) => ({
        x: (cell[0] - massCenterX) * this.fishCellSize,
        y: (cell[1] - massCenterY) * this.fishCellSize,
      })),
    };
  }

  createFishCollisionBodyFromCells(spawnX, spawnY, cellOffsets) {
    const MatterBodies = Phaser.Physics.Matter.Matter.Bodies;
    const MatterBody = Phaser.Physics.Matter.Matter.Body;
    const bodyParts = cellOffsets.map((offset) =>
      MatterBodies.rectangle(
        spawnX + offset.x,
        spawnY + offset.y,
        this.fishVisualSize,
        this.fishVisualSize,
        {
          friction: 0.85,
          frictionStatic: 1,
          frictionAir: 0.018,
          restitution: 0,
          density: this.fallingDensity,
          isSensor: false,
        }
      )
    );

    // 这里创建的是一个 compound body：整体只有一个 body，内部有 4 个碰撞 part。
    // 对游戏逻辑来说它仍然是一个冻鱼块；对手动落地检测来说它贴合真实形状。
    return MatterBody.create({
      parts: bodyParts,
      friction: 0.85,
      frictionStatic: 1,
      frictionAir: 0.018,
      restitution: 0,
      density: this.fallingDensity,
      isSensor: false,
    });
  }

  applyFishMaterial(body, material) {
    if (!body) {
      return;
    }

    const MatterBody = Phaser.Physics.Matter.Matter.Body;
    const parts = body.parts && body.parts.length > 0 ? body.parts : [body];

    if (material.density !== undefined) {
      MatterBody.setDensity(body, material.density);
    }

    parts.forEach((part) => {
      if (material.friction !== undefined) part.friction = material.friction;
      if (material.frictionStatic !== undefined) part.frictionStatic = material.frictionStatic;
      if (material.frictionAir !== undefined) part.frictionAir = material.frictionAir;
      if (material.restitution !== undefined) part.restitution = material.restitution;
    });

    if (material.frictionAir !== undefined) {
      body.frictionAir = material.frictionAir;
    }
  }

  configureBodyAsNoCollision(body) {
    if (!body) {
      return;
    }

    this.forEachBodyPart(body, (part) => {
      part.isSensor = true;
      part.collisionFilter.category = 0x0002;
      part.collisionFilter.mask = 0;
    });
  }

  configureBodyForCollision(body) {
    if (!body) {
      return;
    }

    this.forEachBodyPart(body, (part) => {
      part.isSensor = false;
      part.collisionFilter.category = 0x0001;
      part.collisionFilter.mask = 0xffffffff;
    });
  }

  forEachBodyPart(body, callback) {
    if (!body) {
      return;
    }

    const parts = body.parts && body.parts.length > 1 ? body.parts.slice(1) : [body];
    parts.forEach((part) => callback(part));
    callback(body);
  }

  positionSpawnBeam(x) {
    if (!this.spawnBeam) {
      return;
    }

    const fallingFish =
      this.currentFish && this.currentFish.falling
        ? this.currentFish.gameObject
        : null;
    let beamCenterX = x + this.currentSpawnBeamCenterOffsetX;
    let beamWidth = this.currentSpawnBeamWidth;

    if (fallingFish && fallingFish.active && fallingFish.body) {
      const bounds = fallingFish.body.bounds;

      beamCenterX = (bounds.min.x + bounds.max.x) / 2;
      beamWidth = bounds.max.x - bounds.min.x;
    }

    const visibleTopY = this.getMainCameraVisibleTopY();
    const beamHeight = this.worldBottomY - visibleTopY + this.fishCellSize * 8;

    this.spawnBeam.setPosition(beamCenterX, visibleTopY + beamHeight / 2);
    this.spawnBeam.setDisplaySize(Math.max(1, beamWidth), beamHeight);
  }

  registerWorldObject(objectOrObjects) {
    const objects = Array.isArray(objectOrObjects) ? objectOrObjects : [objectOrObjects];

    this.worldObjects.push(...objects);

    if (this.uiCamera) {
      // UI 相机不渲染游戏世界对象。
      this.uiCamera.ignore(objects);
    }
  }

  registerUiObject(objectOrObjects) {
    const objects = Array.isArray(objectOrObjects) ? objectOrObjects : [objectOrObjects];

    this.uiObjects.push(...objects);

    // 主相机不渲染底部 UI 对象。
    this.cameras.main.ignore(objects);
  }

  getFishSpawnY(layout) {
    const visibleTopY = this.getMainCameraVisibleTopY();
    const localBottomY = Math.max(...layout.cellOffsets.map((offset) => offset.y + this.fishVisualSize / 2));

    // 新鱼块从当前游戏视野的最顶端进入。
    // 这里让鱼块底边先贴在可视区域顶端，随后匀速落入画面；
    // 这样不会突然出现在一个已经离顶部很远的高度。
    return visibleTopY - localBottomY;
  }

  getMainCameraVisibleTopY() {
    const camera = this.cameras.main;

    // camera.scrollY 不是缩放后屏幕顶边对应的世界 y。
    // Phaser 默认围绕视口中心缩放，所以需要把 origin 带来的屏幕偏移反推回世界坐标。
    return camera.scrollY - (camera.height * camera.originY * (1 - this.cameraZoom)) / this.cameraZoom;
  }

  getMainCameraVisibleLeftX() {
    const camera = this.cameras.main;

    return camera.scrollX - (camera.width * camera.originX * (1 - this.cameraZoom)) / this.cameraZoom;
  }

  getMainCameraVisibleRightX() {
    return this.getMainCameraVisibleLeftX() + this.cameras.main.width / this.cameraZoom;
  }

  updateGroundVisualBounds() {
    if (!this.snowBase || !this.snowEdge) {
      return;
    }

    const visibleLeftX = this.getMainCameraVisibleLeftX();
    const visibleRightX = this.getMainCameraVisibleRightX();
    const visibleCenterX = (visibleLeftX + visibleRightX) / 2;
    const visibleWidth = visibleRightX - visibleLeftX;
    const paddedWidth = visibleWidth + 120;

    this.snowBase.setPosition(visibleCenterX, this.worldBottomY - this.groundHeight / 2);
    this.snowBase.setDisplaySize(paddedWidth, this.groundHeight);
    this.snowEdge.setPosition(visibleCenterX, this.worldBottomY - this.groundHeight + 2);
    this.snowEdge.setDisplaySize(paddedWidth, 4);

    if (this.backdropBackground) {
      this.backdropBackground.setX(visibleCenterX);
      this.backdropBackground.setDisplaySize(paddedWidth, this.backdropBackground.displayHeight);
    }
  }

  updateTowerCamera(snapToTarget = false) {
    const camera = this.cameras.main;
    const bottomWorldY = this.worldBottomY;
    const currentTowerTopY = this.getHighestStackFishY();

    // 相机不能直接追每帧的物理 bounds，否则 Matter 的细小抖动会被相机放大成画面抖动。
    // 这里把塔顶高度做成“只在明显变高时更新”的稳定值。
    if (this.stableTowerTopY === null) {
      this.stableTowerTopY = currentTowerTopY;
    } else if (currentTowerTopY < this.stableTowerTopY - this.cameraHeightUpdateThreshold) {
      this.stableTowerTopY = currentTowerTopY;
    }

    const towerHeight = bottomWorldY - this.stableTowerTopY;
    const zoomStartHeight = this.gameViewHeight * this.cameraZoomStartRatio;

    // 只有鱼塔高度超过游戏区 60% 时才开始缩放。
    // 超过后，让“车底到塔顶”的高度大约占屏幕 60%，给上方新鱼块留下空间。
    const targetZoom = Phaser.Math.Clamp(zoomStartHeight / towerHeight, this.minCameraZoom, 1);

    this.cameraZoom = snapToTarget
      ? targetZoom
      : Phaser.Math.Linear(this.cameraZoom, targetZoom, this.cameraSmoothing);
    camera.setZoom(this.cameraZoom);

    const gameViewportWidth = camera.width;
    const gameViewportHeight = camera.height;
    const worldCenterX = this.scale.width / 2;
    const groundWorldY = bottomWorldY;

    // Phaser 的 camera zoom 默认围绕视口中心缩放，不是左上角。
    // 直接用 viewport / zoom 计算 scroll 时，缩放补偿会把车底投到游戏区下方。
    // 这里反推“指定世界坐标应该落在指定屏幕坐标”时需要的 scroll，
    // 让车底始终贴住蓝色游戏区底边，同时保持水平居中。
    const targetScrollX =
      worldCenterX -
      (gameViewportWidth / 2 - gameViewportWidth * camera.originX * (1 - this.cameraZoom)) /
        this.cameraZoom;
    const targetScrollY =
      groundWorldY -
      (gameViewportHeight - gameViewportHeight * camera.originY * (1 - this.cameraZoom)) /
        this.cameraZoom;

    // 地面/车底是硬锚点，不能用平滑追赶。
    // 如果 scrollY 慢半拍，缩放时车会被裁到游戏区下面，看起来就像消失了。
    camera.scrollX = targetScrollX;
    camera.scrollY = targetScrollY;
    this.targetX = this.clampCarX(this.targetX);
    this.updateGroundVisualBounds();
    this.positionSpawnBeam(this.currentSpawnX || this.scale.width / 2);
  }

  getHighestStackFishY() {
    const stackPieces = [];

    // 只使用已经落地或冻结的鱼块来决定相机高度。
    // 当前正在 falling 的鱼块会快速移动，不应该带着相机上下追。
    this.landedPieces.forEach((piece) => {
      if (piece.active && piece.body) stackPieces.push(piece);
    });

    this.frozenPieces.forEach((piece) => {
      if (piece.active && piece.body) stackPieces.push(piece);
    });

    if (stackPieces.length === 0) {
      return this.worldBottomY - this.carBaseHeight;
    }

    // Matter 的 bounds.min.y 表示这个刚体碰撞盒的最上方世界坐标。
    return stackPieces.reduce((highestY, piece) => Math.min(highestY, piece.body.bounds.min.y), Number.POSITIVE_INFINITY);
  }

  createInputControls() {
    // Phaser pointer 同时兼容鼠标和触屏。
    // 手机按住左/右半屏，和 PC 鼠标按住左/右半屏会走同一套逻辑。
    this.input.addPointer(1);

    // PC 额外支持键盘：A/D 或左右方向键。
    this.keys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      cursorLeft: Phaser.Input.Keyboard.KeyCodes.LEFT,
      cursorRight: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      rotateC: Phaser.Input.Keyboard.KeyCodes.C,
      rotateE: Phaser.Input.Keyboard.KeyCodes.E,
      dropZ: Phaser.Input.Keyboard.KeyCodes.Z,
      dropQ: Phaser.Input.Keyboard.KeyCodes.Q,
      debugSpawn: Phaser.Input.Keyboard.KeyCodes.SPACE,
      pauseEsc: Phaser.Input.Keyboard.KeyCodes.ESC,
      restartR: Phaser.Input.Keyboard.KeyCodes.R,
    });

    // C / E 触发一次旋转，不需要长按持续旋转。
    this.keys.rotateC.on("down", () => {
      if (!this.isPaused) this.rotateCurrentFish();
    });
    this.keys.rotateE.on("down", () => {
      if (!this.isPaused) this.rotateCurrentFish();
    });

    // 临时调试能力：按空格键生成新的冻鱼块。
    // 只有当前鱼块已经落地后才会生效，避免同屏出现两个 falling 鱼块。
    // 后续接正式生成流程时，可以直接删掉这段监听。
    this.keys.debugSpawn.on("down", () => {
      if (!this.isPaused) this.spawnDebugFishBlock();
    });
    this.keys.pauseEsc.on("down", () => this.togglePause());
    this.keys.restartR.on("down", () => this.restartGame());
  }

  createControlPanel() {
    // 底部单独开辟一块操作区。
    // 这块区域只放按钮，不参与 Matter 物理，也不跟随游戏相机缩放。
    const panel = this.add.rectangle(
      this.scale.width / 2,
      this.gameViewHeight + this.uiPanelHeight / 2,
      this.scale.width,
      this.uiPanelHeight,
      0x573927,
      1
    );
    const topLine = this.add.rectangle(
      this.scale.width / 2,
      this.gameViewHeight,
      this.scale.width,
      2,
      0x2d2017,
      0.75
    );
    const loadBackground = this.add.rectangle(
      this.scale.width / 2,
      this.gameViewHeight + this.uiPanelHeight / 2,
      168,
      46,
      0x6e4b31,
      1
    );
    this.loadLabel = this.add.text(
      this.scale.width / 2,
      this.gameViewHeight + this.uiPanelHeight / 2,
      "",
      {
        fontFamily: '"Microsoft YaHei", "Noto Sans SC", Arial, sans-serif',
        fontSize: "18px",
        color: "#f8e7bd",
        fontStyle: "bold",
      }
    );

    panel.setDepth(900);
    topLine.setDepth(901);
    loadBackground.setDepth(902);
    loadBackground.setStrokeStyle(2, 0x2d2017);
    this.loadLabel.setDepth(903);
    this.loadLabel.setOrigin(0.5);
    this.loadLabel.setPadding(0, 7, 0, 5);
    this.updateLoadLabel();
    this.registerUiObject([panel, topLine, loadBackground, this.loadLabel]);
  }

  updateLoadLabel() {
    if (!this.loadLabel) return;
    this.loadLabel.setText(`\u88c5\u8f7d${this.loadedFishCount}\u6761\u51bb\u9c7c`);
  }

  createTopHud() {
    const hudObjects = [];
    const tagX = 38;
    const tagY = 126;
    const tagWidth = 48;
    const tagHeight = 206;
    const rope = this.add.rectangle(tagX, tagY - tagHeight / 2 - 42, 5, 86, 0x2d2017, 1);
    const ring = this.add.circle(tagX, tagY - tagHeight / 2 - 8, 10, 0xd0a869, 1);
    const ringHole = this.add.circle(tagX, tagY - tagHeight / 2 - 8, 5, 0x2d2017, 1);
    const tag = this.add.rectangle(tagX, tagY, tagWidth, tagHeight, 0xa87941, 1);

    tag.setStrokeStyle(3, 0x2d2017);
    rope.setDepth(980);
    ring.setDepth(981);
    ringHole.setDepth(982);
    tag.setDepth(980);
    hudObjects.push(rope, ring, ringHole, tag);

    this.lifeHearts = [];

    for (let i = 0; i < this.maxLives; i += 1) {
      const heart = this.add.text(tagX, tagY - 76 + i * 38, "\u2665", {
        fontSize: "34px",
        color: "#d8505c",
        fontStyle: "bold",
        stroke: "#f8dcc2",
        strokeThickness: 4,
      });

      heart.setOrigin(0.5);
      heart.setDepth(990);
      this.lifeHearts.push(heart);
      hudObjects.push(heart);
    }

    const closeX = this.scale.width - 68;
    const closeY = 54;
    const restartX = closeX - 58;
    const restartY = closeY;
    const restartCircle = this.add.circle(0, 0, 22, 0xd0a869, 0.65);
    const restartMark = this.add.text(0, -1, "\u21bb", {
      fontSize: "34px",
      color: "#3a2619",
      fontStyle: "bold",
    });
    const closeCircle = this.add.circle(0, 0, 22, 0xd0a869, 0.65);
    const closeMark = this.add.text(0, -1, "\u00d7", {
      fontSize: "38px",
      color: "#3a2619",
      fontStyle: "bold",
    });

    restartCircle.setStrokeStyle(3, 0x3a2619, 0.85);
    restartCircle.setDepth(980);
    restartMark.setOrigin(0.5);
    restartMark.setDepth(990);
    this.restartButton = this.add.container(restartX, restartY, [
      restartCircle,
      restartMark,
    ]);
    this.restartButton.setDepth(1200);
    this.restartButton.setSize(44, 44);
    this.restartButton.setInteractive(
      new Phaser.Geom.Circle(22, 22, 22),
      Phaser.Geom.Circle.Contains
    );
    this.restartButton.on("pointerdown", (pointer, localX, localY, event) => {
      if (event) event.stopPropagation();
      this.restartGame();
    });
    closeCircle.setStrokeStyle(3, 0x3a2619, 0.85);
    closeCircle.setDepth(980);
    closeMark.setOrigin(0.5);
    closeMark.setDepth(990);
    this.closeButton = this.add.container(closeX, closeY, [closeCircle, closeMark]);
    this.closeButton.setDepth(1200);
    this.closeButton.setSize(44, 44);
    this.closeButton.setInteractive(
      new Phaser.Geom.Circle(22, 22, 22),
      Phaser.Geom.Circle.Contains
    );
    this.closeButton.on("pointerdown", (pointer, localX, localY, event) => {
      if (event) event.stopPropagation();
      this.togglePause();
    });
    hudObjects.push(this.restartButton);
    hudObjects.push(this.closeButton);

    this.updateLifeHearts();
    this.registerUiObject(hudObjects);
  }

  createPauseOverlay() {
    const shade = this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width,
      this.scale.height,
      0x2d2017,
      0.48
    );
    const label = this.add.text(
      this.scale.width / 2,
      this.scale.height / 2,
      "\u6682\u505c",
      {
        fontFamily: '"Microsoft YaHei", "Noto Sans SC", Arial, sans-serif',
        fontSize: "42px",
        color: "#f8e7bd",
        fontStyle: "bold",
      }
    );

    shade.setDepth(1100);
    label.setDepth(1101);
    label.setOrigin(0.5);
    label.setPadding(0, 10, 0, 8);
    this.pauseLabel = label;
    this.pauseOverlayObjects = [shade, label];
    this.pauseOverlayObjects.forEach((object) => object.setVisible(false));
    this.registerUiObject(this.pauseOverlayObjects);
  }

  togglePause() {
    if (this.isGameOver) {
      return;
    }

    this.setPaused(!this.isPaused);
  }

  setPaused(paused, gameOver = false) {
    if (this.isPaused === paused) {
      if (gameOver) {
        this.isGameOver = true;
        if (this.pauseLabel) {
          this.pauseLabel.setText("\u6e38\u620f\u7ed3\u675f");
        }
        this.pauseOverlayObjects.forEach((object) => object.setVisible(true));
      }
      return;
    }

    this.isPaused = paused;
    this.isGameOver = gameOver;
    this.isDropButtonHeld = false;
    if (this.pauseLabel) {
      this.pauseLabel.setText(gameOver ? "\u6e38\u620f\u7ed3\u675f" : "\u6682\u505c");
    }

    this.pauseOverlayObjects.forEach((object) => object.setVisible(paused));
    this.setMatterWorldPaused(paused);
    this.time.paused = paused;

    if (paused && this.currentFish && this.currentFish.falling) {
      const fish = this.currentFish.gameObject;

      if (fish && fish.body) {
        Phaser.Physics.Matter.Matter.Body.setVelocity(fish.body, { x: 0, y: 0 });
      }
    }
  }

  restartGame() {
    this.isGameOver = false;
    this.isPaused = false;
    this.isDropButtonHeld = false;
    this.time.paused = false;
    this.setMatterWorldPaused(false);
    this.scene.restart();
  }

  loseLife() {
    if (this.isGameOver || this.lives <= 0) {
      return;
    }

    this.lives = Math.max(0, this.lives - 1);
    this.updateLifeHearts();

    if (this.lives === 0) {
      this.setPaused(true, true);
    }
  }

  setMatterWorldPaused(paused) {
    const world = this.matter && this.matter.world;

    if (!world) {
      return;
    }

    if (paused) {
      if (typeof world.pause === "function") {
        world.pause();
      } else {
        world.enabled = false;
      }
      return;
    }

    if (typeof world.resume === "function") {
      world.resume();
    } else {
      world.enabled = true;
    }
  }

  updateLifeHearts() {
    this.lifeHearts.forEach((heart, index) => {
      const alive = index < this.lives;
      heart.setColor(alive ? "#d8505c" : "#9a9a9a");
      heart.setAlpha(alive ? 1 : 0.85);
    });
  }

  spawnDebugFishBlock() {
    if (this.isSpawnScheduled || (this.currentFish && this.currentFish.falling)) {
      return;
    }

    this.createFallingFishBlock();
  }

  createDropButton() {
    // 左下角下落按钮。按住时切到更快的固定下落速度，松开恢复普通匀速下落。
    const buttonX = 68;
    const buttonY = this.gameViewHeight + this.uiPanelHeight / 2;
    const buttonWidth = 96;
    const buttonHeight = 44;
    const background = this.add.rectangle(0, 0, buttonWidth, buttonHeight, 0xf4d69d, 1);
    const label = this.add.text(0, 0, "\u4e0b\u843d", {
      fontFamily: '"Microsoft YaHei", "Noto Sans SC", Arial, sans-serif',
      fontSize: "22px",
      color: "#4a2a1a",
      fontStyle: "bold",
    });

    label.setOrigin(0.5);
    label.setPadding(0, 8, 0, 6);
    background.setStrokeStyle(2, 0x6d4a2f);

    this.dropButton = this.add.container(buttonX, buttonY, [background, label]);
    // 记录按钮在屏幕上的位置，用于后面判断 pointer 是否点在按钮区域。
    // 按钮本身由 UI 相机渲染，不会跟着游戏相机缩放。
    this.dropButton.setData("screenX", buttonX);
    this.dropButton.setData("screenY", buttonY);
    this.dropButton.setData("screenWidth", buttonWidth);
    this.dropButton.setData("screenHeight", buttonHeight);
    this.dropButton.setDepth(1000);
    this.dropButton.setSize(buttonWidth, buttonHeight);
    this.registerUiObject(this.dropButton);
    this.dropButton.setInteractive({ useHandCursor: true });

    this.dropButton.on("pointerdown", (pointer, localX, localY, event) => {
      if (event) event.stopPropagation();
      if (this.isPaused) return;
      this.isDropButtonHeld = true;
    });
    this.dropButton.on("pointerup", () => { this.isDropButtonHeld = false; });
    this.dropButton.on("pointerout", () => { this.isDropButtonHeld = false; });
    this.dropButton.on("pointerupoutside", () => { this.isDropButtonHeld = false; });
  }

  createRotateButton() {
    // 右下角旋转按钮。Phaser 的 interactive 对象同时支持鼠标和触屏。
    const buttonX = this.scale.width - 68;
    const buttonY = this.gameViewHeight + this.uiPanelHeight / 2;
    const buttonWidth = 96;
    const buttonHeight = 44;
    const background = this.add.rectangle(0, 0, buttonWidth, buttonHeight, 0xf4d69d, 1);
    const label = this.add.text(0, 0, "\u65cb\u8f6c", {
      fontFamily: '"Microsoft YaHei", "Noto Sans SC", Arial, sans-serif',
      fontSize: "22px",
      color: "#4a2a1a",
      fontStyle: "bold",
    });

    label.setOrigin(0.5);
    label.setPadding(0, 8, 0, 6);
    background.setStrokeStyle(2, 0x6d4a2f);

    this.rotateButton = this.add.container(buttonX, buttonY, [background, label]);
    // 记录按钮在屏幕上的位置，用于后面判断 pointer 是否点在按钮区域。
    // 按钮本身由 UI 相机渲染，不会跟着游戏相机缩放。
    this.rotateButton.setData("screenX", buttonX);
    this.rotateButton.setData("screenY", buttonY);
    this.rotateButton.setData("screenWidth", buttonWidth);
    this.rotateButton.setData("screenHeight", buttonHeight);
    this.rotateButton.setDepth(1000);
    this.rotateButton.setSize(buttonWidth, buttonHeight);
    this.registerUiObject(this.rotateButton);
    this.rotateButton.setInteractive({ useHandCursor: true });

    this.rotateButton.on("pointerdown", (pointer, localX, localY, event) => {
      // 阻止按钮点击继续传给场景输入，避免点按钮时顺便推动车子向右。
      if (event) event.stopPropagation();
      if (this.isPaused) return;
      this.rotateCurrentFish();
    });
  }

  createCollisionHandlers() {
    this.matter.world.on("collisionstart", (event) => {
      event.pairs.forEach((pair) => {
        if (this.suppressInvalidCarCollision(pair)) {
          return;
        }

        this.handleFishCollision(pair.bodyA, pair.bodyB);
      });
    });

    this.matter.world.on("collisionactive", (event) => {
      event.pairs.forEach((pair) => {
        if (this.suppressInvalidCarCollision(pair)) {
          return;
        }

        this.handleFishCollision(pair.bodyA, pair.bodyB);
      });
    });
  }

  suppressInvalidCarCollision(pair) {
    const objectA = this.getBodyGameObject(pair.bodyA);
    const objectB = this.getBodyGameObject(pair.bodyB);
    const carObject = objectA && objectA.getData("type") === "car" ? objectA : objectB && objectB.getData("type") === "car" ? objectB : null;
    const fishObject = objectA && objectA.getData("type") === "fish" ? objectA : objectB && objectB.getData("type") === "fish" ? objectB : null;

    if (!carObject || !fishObject || !fishObject.body) {
      return false;
    }

    const baseTop = this.car.y - this.carBaseHeight / 2;
    const carPartKind = carObject.getData("carPartKind");
    const allowedTopCollision =
      carPartKind === "base"
        ? fishObject.body.bounds.min.y < baseTop - 1
        : fishObject.body.bounds.min.y < baseTop - this.fishVisualSize * 0.35;

    if (allowedTopCollision) {
      return false;
    }

    pair.isActive = false;

    if (pair.collision) {
      pair.collision.collided = false;
    }

    return true;
  }

  handleFishCollision(bodyA, bodyB) {
    if (!this.currentFish || !this.currentFish.falling) {
      return;
    }

    const objectA = this.getBodyGameObject(bodyA);
    const objectB = this.getBodyGameObject(bodyB);

    const fish = this.currentFish.gameObject;

    if (objectA !== fish && objectB !== fish) {
      return;
    }

    const other = objectA === fish ? objectB : objectA;

    if (!other) {
      return;
    }

    const otherType = other.getData("type");
    const otherCanSupport = otherType === "car" || (otherType === "fish" && other.getData("landed") === true);

    if (!otherCanSupport || !this.isValidSupportLanding(fish, other)) {
      return;
    }

    this.markCurrentFishLanded(other);
  }

  isIcePiece(piece) {
    return (
      piece &&
      piece.getData &&
      piece.getData("type") === "fish" &&
      piece.getData("pieceKind") === "ice"
    );
  }

  isCountedFishPiece(piece) {
    return (
      piece &&
      piece.getData &&
      piece.getData("type") === "fish" &&
      piece.getData("pieceKind") !== "ice"
    );
  }

  isFreezePiece(piece) {
    return (
      piece &&
      piece.active &&
      piece.body &&
      piece.getData &&
      piece.getData("type") === "fish" &&
      piece.getData("destroyed") !== true
    );
  }

  updateStableFlatFreezes() {
    const now = this.time ? this.time.now : 0;
    const pieces = this.getCarriedPieces().filter((piece) => {
      return this.isFreezePiece(piece) && piece.getData("falling") !== true;
    });
    const activeKeys = new Set();

    pieces.forEach((piece) => {
      this.updatePieceFreezeStability(piece);
    });

    pieces.forEach((piece) => {
      if (this.hasStableFlatFreezeContact(piece, this.car)) {
        this.trackStableFreezeContact(piece, this.car, now, activeKeys);
      }
    });

    for (let i = 0; i < pieces.length; i += 1) {
      for (let j = i + 1; j < pieces.length; j += 1) {
        const pieceA = pieces[i];
        const pieceB = pieces[j];

        if (this.hasStableFlatFreezeContact(pieceA, pieceB)) {
          this.trackStableFreezeContact(pieceA, pieceB, now, activeKeys);
        }
      }
    }

    this.cleanupInactiveFreezeContacts(activeKeys, now);
  }

  updatePieceFreezeStability(piece) {
    if (!this.isFreezePiece(piece)) {
      return;
    }

    if (piece.getData("frozen") && piece.body.isStatic) {
      piece.setData("freezeStable", true);
      piece.setData("freezeLastPose", this.getFreezeRelativePose(piece));
      return;
    }

    const pose = this.getFreezeRelativePose(piece);
    const lastPose = piece.getData("freezeLastPose");
    const angularSpeed = Math.abs(piece.body.angularVelocity || 0);
    const stable =
      !!lastPose &&
      Math.abs(pose.x - lastPose.x) <= this.freezeMaxRelativeStep &&
      Math.abs(pose.y - lastPose.y) <= this.freezeStablePositionTolerance &&
      this.getAngleDifference(pose.angle, lastPose.angle) <= this.freezeStableAngleTolerance &&
      angularSpeed <= this.freezeMaxAngularSpeed;

    piece.setData("freezeStable", stable);
    piece.setData("freezeLastPose", pose);
  }

  getFreezeRelativePose(piece) {
    const position = piece.body && piece.body.position ? piece.body.position : { x: piece.x, y: piece.y };
    const carX = this.car ? this.car.x : 0;
    const carY = this.car ? this.car.y : 0;

    return {
      x: position.x - carX,
      y: position.y - carY,
      angle: this.normalizeRightAngle(piece.body ? piece.body.angle || 0 : piece.rotation || 0),
    };
  }

  hasStableFlatFreezeContact(objectA, objectB) {
    if (!this.canObjectJoinFreezeContact(objectA) || !this.canObjectJoinFreezeContact(objectB)) {
      return false;
    }

    if (!this.areFreezeObjectsStable(objectA, objectB)) {
      return false;
    }

    const partsA = this.getFreezeContactParts(objectA);
    const partsB = this.getFreezeContactParts(objectB);

    return partsA.some((partA) => {
      return partsB.some((partB) => this.arePartFacesFlatTouching(partA, partB));
    });
  }

  canObjectJoinFreezeContact(object) {
    if (!object || !object.getData) {
      return false;
    }

    if (object.getData("type") === "car") {
      return true;
    }

    return this.isFreezePiece(object) && object.getData("falling") !== true;
  }

  areFreezeObjectsStable(objectA, objectB) {
    return this.isFreezeObjectStable(objectA) && this.isFreezeObjectStable(objectB);
  }

  isFreezeObjectStable(object) {
    if (!object || !object.getData) {
      return false;
    }

    if (object.getData("type") === "car") {
      return true;
    }

    return (
      (object.getData("frozen") === true && object.body && object.body.isStatic) ||
      object.getData("freezeStable") === true
    );
  }

  getFreezeContactParts(object) {
    if (!object || !object.getData) {
      return [];
    }

    if (object.getData("type") === "car") {
      return this.carParts
        .filter((part) => part && part.active && part.body)
        .flatMap((part) => this.getCollisionParts(part.body));
    }

    return object.body ? this.getCollisionParts(object.body) : [];
  }

  arePartFacesFlatTouching(partA, partB) {
    const minContactSpan = this.fishVisualSize * this.freezeMinContactRatio;
    const tolerance = this.freezeSurfaceTolerance;
    const edgesA = this.getPartFaceEdges(partA);
    const edgesB = this.getPartFaceEdges(partB);

    return edgesA.some((edgeA) => {
      return edgesB.some((edgeB) => {
        return this.areEdgesFlatTouching(edgeA, edgeB, minContactSpan, tolerance);
      });
    });
  }

  getPartFaceEdges(part) {
    if (!part || !part.vertices || part.vertices.length < 2) {
      return [];
    }

    const vertices = part.vertices;

    return vertices.map((start, index) => {
      const end = vertices[(index + 1) % vertices.length];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.sqrt(dx * dx + dy * dy);

      return {
        start,
        end,
        length,
        dirX: length > 0 ? dx / length : 0,
        dirY: length > 0 ? dy / length : 0,
      };
    }).filter((edge) => edge.length > 1);
  }

  areEdgesFlatTouching(edgeA, edgeB, minContactSpan, tolerance) {
    return !!this.getFlatEdgeContact(edgeA, edgeB, minContactSpan, tolerance);
  }

  getFlatEdgeContact(edgeA, edgeB, minContactSpan, tolerance) {
    const parallelError = Math.abs(edgeA.dirX * edgeB.dirY - edgeA.dirY * edgeB.dirX);

    if (parallelError > this.freezeParallelAngleTolerance) {
      return null;
    }

    const normalX = -edgeA.dirY;
    const normalY = edgeA.dirX;
    const offsetX = edgeB.start.x - edgeA.start.x;
    const offsetY = edgeB.start.y - edgeA.start.y;
    const signedDistance = offsetX * normalX + offsetY * normalY;
    const lineDistance = Math.abs(signedDistance);

    if (lineDistance > tolerance) {
      return null;
    }

    const a0 = 0;
    const a1 = edgeA.length;
    const b0 = offsetX * edgeA.dirX + offsetY * edgeA.dirY;
    const b1 =
      (edgeB.end.x - edgeA.start.x) * edgeA.dirX +
      (edgeB.end.y - edgeA.start.y) * edgeA.dirY;
    const overlap = Math.min(a1, Math.max(b0, b1)) - Math.max(a0, Math.min(b0, b1));

    if (overlap < minContactSpan) {
      return null;
    }

    return {
      edgeA,
      edgeB,
      signedDistance,
      lineDistance,
      normalX,
      normalY,
      overlap,
      score: lineDistance + parallelError * this.fishVisualSize,
    };
  }

  trackStableFreezeContact(objectA, objectB, now, activeKeys) {
    if (!this.canFreezeContactMerge(objectA, objectB)) {
      return;
    }

    const key = this.getFreezeContactKey(objectA, objectB);
    const delayMs = this.getFreezeDelayForContact(objectA, objectB);
    let pending = this.pendingFlatFreezes.get(key);

    activeKeys.add(key);

    if (!pending) {
      pending = {
        objectA,
        objectB,
        startedAt: now,
        lastContactAt: now,
        delayMs,
      };
      this.pendingFlatFreezes.set(key, pending);
    } else {
      pending.objectA = objectA;
      pending.objectB = objectB;
      pending.lastContactAt = now;
      pending.delayMs = Math.min(pending.delayMs, delayMs);
    }

    if (now - pending.startedAt >= pending.delayMs) {
      this.snapFreezeContactObjects(objectA, objectB);
      this.freezeContactObjects(objectA, objectB);
      this.pendingFlatFreezes.delete(key);
    }
  }

  canFreezeContactMerge(objectA, objectB) {
    const mergeableObjects = [objectA, objectB].filter((object) => this.isFreezePiece(object));

    if (mergeableObjects.length === 0) {
      return false;
    }

    return this.getFreezeObjectId(objectA) !== this.getFreezeObjectId(objectB);
  }

  cleanupInactiveFreezeContacts(activeKeys, now) {
    this.pendingFlatFreezes.forEach((pending, key) => {
      if (
        !this.canObjectJoinFreezeContact(pending.objectA) ||
        !this.canObjectJoinFreezeContact(pending.objectB) ||
        now - pending.lastContactAt > this.freezeContactGraceMs
      ) {
        this.pendingFlatFreezes.delete(key);
        return;
      }

      if (!activeKeys.has(key) && now - pending.lastContactAt > this.freezeContactGraceMs) {
        this.pendingFlatFreezes.delete(key);
      }
    });
  }

  getFreezeContactKey(objectA, objectB) {
    const idA = this.getFreezeObjectId(objectA);
    const idB = this.getFreezeObjectId(objectB);

    return [idA, idB].sort().join("|");
  }

  getFreezeObjectId(object) {
    if (!object || !object.getData) {
      return "unknown";
    }

    if (object.getData("type") === "car") {
      return "car";
    }

    let id = object.getData("freezeObjectId");

    if (!id) {
      id = `piece-${this.nextCargoPieceId}`;
      this.nextCargoPieceId += 1;
      object.setData("freezeObjectId", id);
    }

    return id;
  }

  getFreezeDelayForContact(objectA, objectB) {
    return this.isIcePiece(objectA) || this.isIcePiece(objectB)
      ? this.iceFreezeDelayMs
      : this.fishFreezeDelayMs;
  }

  freezeContactObjects(objectA, objectB) {
    [objectA, objectB].forEach((object) => {
      if (this.isFreezePiece(object) && !object.getData("frozen")) {
        this.freezePiece(object);
      }
    });

    this.mergeFreezeObjects(objectA, objectB);
  }

  snapFreezeContactObjects(objectA, objectB) {
    const movableObject = this.getFreezeSnapMovableObject(objectA, objectB);

    if (!movableObject || !movableObject.body) {
      return;
    }

    let contact = this.getBestFlatContact(objectA, objectB);

    if (!contact) {
      return;
    }

    const MatterBody = Phaser.Physics.Matter.Matter.Body;
    const angleCorrection = this.getFreezeSnapAngleCorrection(contact, movableObject, objectA, objectB);

    if (
      Math.abs(angleCorrection) > 0.001 &&
      Math.abs(angleCorrection) <= this.freezeParallelAngleTolerance
    ) {
      MatterBody.rotate(movableObject.body, angleCorrection);
      contact = this.getBestFlatContact(objectA, objectB);
    }

    if (!contact || contact.lineDistance <= 0.05) {
      return;
    }

    const moveSign = movableObject === objectA ? 1 : -1;
    const correction = {
      x: contact.normalX * contact.signedDistance * moveSign,
      y: contact.normalY * contact.signedDistance * moveSign,
    };
    const maxCorrection = this.freezeSurfaceTolerance + this.landingSeparation + 0.5;
    const correctionLength = Math.sqrt(correction.x * correction.x + correction.y * correction.y);

    if (correctionLength > maxCorrection) {
      return;
    }

    MatterBody.translate(movableObject.body, correction, false);
    MatterBody.setVelocity(movableObject.body, { x: 0, y: 0 });
    MatterBody.setAngularVelocity(movableObject.body, 0);
  }

  getFreezeSnapAngleCorrection(contact, movableObject, objectA, objectB) {
    const sourceEdge = movableObject === objectA ? contact.edgeA : contact.edgeB;
    const targetEdge = movableObject === objectA ? contact.edgeB : contact.edgeA;
    const sourceAngle = Math.atan2(sourceEdge.dirY, sourceEdge.dirX);
    const targetAngle = Math.atan2(targetEdge.dirY, targetEdge.dirX);
    const sameDirectionDelta = Phaser.Math.Angle.Wrap(targetAngle - sourceAngle);
    const oppositeDirectionDelta = Phaser.Math.Angle.Wrap(targetAngle + Math.PI - sourceAngle);

    return Math.abs(sameDirectionDelta) <= Math.abs(oppositeDirectionDelta)
      ? sameDirectionDelta
      : oppositeDirectionDelta;
  }

  getFreezeSnapMovableObject(objectA, objectB) {
    const candidates = [objectA, objectB].filter((object) => {
      return this.isFreezePiece(object) && object.body && !object.body.isStatic;
    });

    if (candidates.length === 0) {
      return null;
    }

    const unfrozen = candidates.find((object) => object.getData("frozen") !== true);
    return unfrozen || candidates[0];
  }

  getBestFlatContact(objectA, objectB) {
    const partsA = this.getFreezeContactParts(objectA);
    const partsB = this.getFreezeContactParts(objectB);
    const minContactSpan = this.fishVisualSize * this.freezeMinContactRatio;
    const tolerance = this.freezeSurfaceTolerance;
    let bestContact = null;

    partsA.forEach((partA) => {
      const edgesA = this.getPartFaceEdges(partA);

      partsB.forEach((partB) => {
        const edgesB = this.getPartFaceEdges(partB);

        edgesA.forEach((edgeA) => {
          edgesB.forEach((edgeB) => {
            const contact = this.getFlatEdgeContact(edgeA, edgeB, minContactSpan, tolerance);

            if (!contact) {
              return;
            }

            if (!bestContact || contact.score < bestContact.score) {
              bestContact = contact;
            }
          });
        });
      });
    });

    return bestContact;
  }

  mergeFreezeObjects(objectA, objectB) {
    const idA = this.getFreezeObjectId(objectA);
    const idB = this.getFreezeObjectId(objectB);

    if (idA === idB) {
      return;
    }

    const mergedId = idA === "car" ? idB : idA;

    this.getCarriedPieces().forEach((piece) => {
      const pieceId = this.getFreezeObjectId(piece);

      if (pieceId !== idA && pieceId !== idB) {
        return;
      }

      piece.setData("freezeObjectId", mergedId);

      if (piece.getData("frozen") === true && piece.body && !piece.body.isStatic) {
        Phaser.Physics.Matter.Matter.Body.setStatic(piece.body, true);
        this.configureBodyForCollision(piece.body);
      }
    });
  }

  normalizeRightAngle(angle) {
    const rightAngle = Math.PI / 2;
    return Phaser.Math.Angle.Wrap(angle - Math.round(angle / rightAngle) * rightAngle);
  }

  getAngleDifference(angleA, angleB) {
    return Math.abs(Phaser.Math.Angle.Wrap(angleA - angleB));
  }

  getBodyGameObject(body) {
    return body.gameObject || (body.parent && body.parent.gameObject) || null;
  }

  isValidSupportLanding(fish, support) {
    if (!fish || !support || !fish.body) {
      return false;
    }

    if (support.getData("type") === "car") {
      return this.isValidCarSupportLanding(fish);
    }

    if (!support.body) {
      return false;
    }

    const supportBounds = support.body.bounds;
    const fishBounds = fish.body.bounds;
    const horizontalOverlap = this.getHorizontalOverlap(fish, support);

    return (
      fishBounds.max.y <= supportBounds.min.y + this.fishVisualSize * 0.9 &&
      horizontalOverlap >= this.fishVisualSize * 0.48
    );
  }

  isValidCarSupportLanding(fish) {
    if (!fish || !fish.body) {
      return false;
    }

    const fishBounds = fish.body.bounds;

    return this.getCarSupportRects().some((supportRect) => {
      const overlapLeft = Math.max(fishBounds.min.x, supportRect.left);
      const overlapRight = Math.min(fishBounds.max.x, supportRect.right);
      const horizontalOverlap = Math.max(0, overlapRight - overlapLeft);

      return (
        fishBounds.max.y <= supportRect.top + this.fishVisualSize * 0.9 &&
        horizontalOverlap >= this.fishVisualSize * 0.48
      );
    });
  }

  getHorizontalOverlap(objectA, objectB) {
    const boundsA = objectA.body.bounds;
    const boundsB = objectB.body.bounds;
    const overlapLeft = Math.max(boundsA.min.x, boundsB.min.x);
    const overlapRight = Math.min(boundsA.max.x, boundsB.max.x);

    return Math.max(0, overlapRight - overlapLeft);
  }

  detectCurrentFishPseudoLanding(delta) {
    if (!this.currentFish || !this.currentFish.falling) {
      return;
    }

    const fish = this.currentFish.gameObject;

    if (!fish || !fish.body) {
      return;
    }

    const fishParts = this.getCollisionParts(fish.body);
    const previousBounds = fish.getData("previousPartBounds") || [];
    const supportCandidates = this.getPseudoSupportCandidates();
    let bestLanding = null;

    fishParts.forEach((fishPart, partIndex) => {
      const previousPartBounds = previousBounds[partIndex] || this.estimatePreviousPartBounds(fishPart, fish.body, delta);

      supportCandidates.forEach((support) => {
        const landing = this.getPseudoLandingCandidate(fish, fishPart, previousPartBounds, support, delta);

        if (!landing) return;

        if (!bestLanding || landing.score < bestLanding.score) {
          bestLanding = landing;
        }
      });
    });

    if (!bestLanding) {
      return;
    }

    this.markCurrentFishLanded(bestLanding);
  }

  getPseudoSupportCandidates() {
    const supports = [];

    this.getCarSupportRects().forEach((supportRect, index) => {
      const syntheticBody = {
        bounds: {
          min: { x: supportRect.left, y: supportRect.top },
          max: { x: supportRect.right, y: supportRect.top + 1 },
        },
        position: {
          x: (supportRect.left + supportRect.right) / 2,
          y: supportRect.top,
        },
      };

      supports.push({
        type: "car",
        owner: this.car,
        body: syntheticBody,
        supportIndex: index,
      });
    });

    this.getCarriedPieces().forEach((piece) => {
      if (!piece || !piece.active || !piece.body) return;

      this.getCollisionParts(piece.body).forEach((part) => {
        supports.push({
          type: "fish",
          owner: piece,
          body: part,
          supportIndex: 0,
        });
      });
    });

    return supports;
  }

  estimatePreviousPartBounds(fishPart, fishBody, delta) {
    const frameScale = Math.max(delta / (1000 / 60), 0.0001);
    const velocity = fishBody.velocity || { x: 0, y: 0 };

    return {
      min: {
        x: fishPart.bounds.min.x - velocity.x * frameScale,
        y: fishPart.bounds.min.y - velocity.y * frameScale,
      },
      max: {
        x: fishPart.bounds.max.x - velocity.x * frameScale,
        y: fishPart.bounds.max.y - velocity.y * frameScale,
      },
    };
  }

  getPseudoLandingCandidate(fish, fishPart, previousPartBounds, support, delta) {
    const supportBounds = support.body.bounds;
    const fishBounds = fishPart.bounds;
    const supportTop = supportBounds.min.y;
    const previousBottom = previousPartBounds.max.y;
    const currentBottom = fishBounds.max.y;
    const horizontalOverlap = this.getBoundsHorizontalOverlap(fishBounds, supportBounds);
    const supportWidth = supportBounds.max.x - supportBounds.min.x;
    const minOverlap = Math.max(5, Math.min(this.fishVisualSize * this.supportMinOverlapRatio, supportWidth * 0.72));
    const velocityY = fish.body.velocity ? fish.body.velocity.y : 0;
    const crossedSupportTop = previousBottom <= supportTop + 1 && currentBottom >= supportTop - 2;
    const isRestingNearSupport =
      currentBottom >= supportTop - 2 &&
      currentBottom <= supportTop + this.pseudoLandingExtraTolerance;
    const isMostlyAboveSupport = fishBounds.min.y < supportTop - this.fishVisualSize * 0.35;
    const isFallingOrSettling = velocityY >= -0.25;

    if (
      (!crossedSupportTop && !isRestingNearSupport) ||
      !isMostlyAboveSupport ||
      !isFallingOrSettling ||
      horizontalOverlap < minOverlap
    ) {
      return null;
    }

    return {
      support,
      fishPart,
      supportTop,
      horizontalOverlap,
      score: Math.abs(currentBottom - supportTop),
    };
  }

  rememberCurrentFishPreviousBounds() {
    if (!this.currentFish || !this.currentFish.falling) {
      return;
    }

    const fish = this.currentFish.gameObject;

    if (!fish || !fish.body) {
      return;
    }

    const boundsSnapshot = this.getCollisionParts(fish.body).map((part) => ({
      min: { x: part.bounds.min.x, y: part.bounds.min.y },
      max: { x: part.bounds.max.x, y: part.bounds.max.y },
    }));

    fish.setData("previousPartBounds", boundsSnapshot);
  }

  markCurrentFishLanded(support) {
    if (!this.currentFish || !this.currentFish.falling) {
      return;
    }

    const fish = this.currentFish.gameObject;
    const landing = support && support.support ? support : null;
    const landingSupport = landing ? landing.support.owner : support;
    const MatterBody = Phaser.Physics.Matter.Matter.Body;

    if (landing) {
      this.snapFishToLandingSupport(fish, landing);
      this.separateFishFromStaticSupports(fish);
    }

    this.currentFish.falling = false;
    this.currentFish.landed = true;
    fish.setData("falling", false);
    fish.setData("landed", true);
    fish.setData("landedAt", this.time.now);
    fish.setData("landingSupport", landingSupport || null);
    if (fish.body) {
      MatterBody.setVelocity(fish.body, { x: 0, y: 0 });
      MatterBody.setAngularVelocity(fish.body, (fish.body.angularVelocity || 0) * 0.2);
    }
    this.setFishFriction(fish, this.landedNoFriction);
    this.landedPieces.push(fish);

    if (!this.isIcePiece(fish)) {
      this.countLoadedFish(fish);
    }

    this.scheduleNextFishBlock();
  }

  countLoadedFish(piece) {
    if (!this.isCountedFishPiece(piece) || piece.getData("countedLoaded")) {
      return;
    }

    piece.setData("countedLoaded", true);
    this.loadedFishCount += 1;
    this.updateLoadLabel();
  }

  uncountLoadedFish(piece) {
    if (!piece || !piece.getData || !piece.getData("countedLoaded")) {
      return;
    }

    piece.setData("countedLoaded", false);
    this.loadedFishCount = Math.max(0, this.loadedFishCount - 1);
    this.updateLoadLabel();
  }

  snapFishToLandingSupport(fish, landing) {
    if (!fish || !fish.body || !landing || !landing.fishPart) {
      return;
    }

    const fishBottom = landing.fishPart.bounds.max.y;
    const targetBottom = landing.supportTop - this.landingSeparation;
    const moveY = targetBottom - fishBottom;

    Phaser.Physics.Matter.Matter.Body.translate(fish.body, { x: 0, y: moveY }, false);
  }

  separateFishFromStaticSupports(fish) {
    if (!fish || !fish.body) {
      return;
    }

    const supportParts = this.getStaticSupportParts();

    if (supportParts.length === 0) {
      return;
    }

    const MatterBody = Phaser.Physics.Matter.Matter.Body;

    for (let pass = 0; pass < this.penetrationResolvePasses; pass += 1) {
      let resolvedThisPass = false;
      const fishParts = this.getCollisionParts(fish.body);

      for (const fishPart of fishParts) {
        for (const supportPart of supportParts) {
          const separation = this.getPartSeparation(fishPart, supportPart);

          if (!separation) continue;

          MatterBody.translate(fish.body, separation, false);
          resolvedThisPass = true;
        }
      }

      if (!resolvedThisPass) break;
    }
  }

  getStaticSupportParts() {
    const supportBodies = [];

    this.carParts.forEach((part) => {
      if (part && part.active && part.body) {
        supportBodies.push(part.body);
      }
    });

    this.landedPieces.forEach((piece) => {
      if (piece && piece.active && piece.body) {
        supportBodies.push(piece.body);
      }
    });

    this.frozenPieces.forEach((piece) => {
      if (piece && piece.active && piece.body) {
        supportBodies.push(piece.body);
      }
    });

    return supportBodies.flatMap((body) => this.getCollisionParts(body));
  }

  getCollisionParts(body) {
    if (!body) return [];
    if (body.parts && body.parts.length > 1) return body.parts.slice(1);
    return [body];
  }

  getPartSeparation(fishPart, supportPart) {
    const overlap = this.getPartOverlap(fishPart, supportPart);

    if (!overlap) {
      return null;
    }

    const fishBounds = fishPart.bounds;
    const supportBounds = supportPart.bounds;
    const overlapX = overlap.x;
    const overlapY = overlap.y;
    const fishCenterX = (fishBounds.min.x + fishBounds.max.x) / 2;
    const supportCenterX = (supportBounds.min.x + supportBounds.max.x) / 2;
    const fishCenterY = (fishBounds.min.y + fishBounds.max.y) / 2;
    const supportCenterY = (supportBounds.min.y + supportBounds.max.y) / 2;
    const padding = this.landingSeparation;

    if (overlapY <= overlapX || fishCenterY < supportCenterY) {
      return {
        x: 0,
        y: fishCenterY < supportCenterY ? -(overlapY + padding) : overlapY + padding,
      };
    }

    return {
      x: fishCenterX < supportCenterX ? -(overlapX + padding) : overlapX + padding,
      y: 0,
    };
  }

  getPartOverlap(partA, partB) {
    const boundsA = partA.bounds;
    const boundsB = partB.bounds;
    const overlapX = Math.min(boundsA.max.x, boundsB.max.x) - Math.max(boundsA.min.x, boundsB.min.x);
    const overlapY = Math.min(boundsA.max.y, boundsB.max.y) - Math.max(boundsA.min.y, boundsB.min.y);

    if (overlapX <= 0.25 || overlapY <= 0.25) {
      return null;
    }

    return { x: overlapX, y: overlapY };
  }

  cleanupFallenStackPieces() {
    const fallLimitY = this.worldBottomY + this.fishCellSize * 5;

    this.landedPieces = this.landedPieces.filter((piece) => {
      if (!piece || !piece.active || !piece.body) {
        return false;
      }

      if (piece.body.bounds.min.y > fallLimitY) {
        this.loseLife();
        this.removeStackPiece(piece);
        return false;
      }

      return true;
    });

    this.frozenPieces = this.frozenPieces.filter((piece) => piece && piece.active && piece.body);
  }

  removeStackPiece(piece) {
    if (!piece) {
      return;
    }

    this.uncountLoadedFish(piece);

    if (piece.body) {
      this.matter.world.remove(piece.body);
    }

    piece.destroy();
  }

  getCarriedPieces() {
    return [...this.landedPieces, ...this.frozenPieces].filter((piece) => {
      return piece && piece.active && piece.body;
    });
  }

  updateCarriedCargoGroups(delta, carMoveX) {
    const pieces = this.getCarriedPieces();
    const frameScale = Math.max(delta / (1000 / 60), 0.0001);

    if (pieces.length === 0) {
      this.lastCarMoveX = carMoveX;
      return;
    }

    const carConnectedPieces = this.getCarConnectedPieces(pieces);
    const groups = this.buildCarriedCargoGroups(pieces);

    groups.forEach((group) => {
      if (!group.pieces.some((piece) => carConnectedPieces.has(piece))) {
        return;
      }

      const state = this.getCargoGroupState(group.pieces);
      const oldOffsetX = state.offsetX;
      const massScale = 1 / Math.sqrt(Math.max(group.mass, 1));
      const accelerationImpulse = 0;

      state.velocityX += accelerationImpulse;
      state.velocityX += -state.offsetX * this.cargoSwaySpring * frameScale;
      state.velocityX *= Math.pow(this.cargoSwayDamping, frameScale);
      state.offsetX += state.velocityX * frameScale;
      state.offsetX = Phaser.Math.Clamp(
        state.offsetX,
        -this.cargoMaxSwayOffset * massScale,
        this.cargoMaxSwayOffset * massScale
      );

      const moveX = carMoveX + (state.offsetX - oldOffsetX);

      if (moveX !== 0) {
        this.translateCargoGroup(group, moveX);
      }

      group.pieces.forEach((piece) => {
        piece.setData("cargoSwayState", {
          offsetX: state.offsetX,
          velocityX: state.velocityX,
        });
      });
    });

    this.resolveCarriedGroupOverlaps(groups);
    this.lastCarMoveX = carMoveX;
  }

  buildCarriedCargoGroups(pieces) {
    const groups = [];
    const visited = new Set();

    pieces.forEach((piece) => {
      if (visited.has(piece)) {
        return;
      }

      const groupPieces = [];
      const queue = [piece];
      visited.add(piece);

      while (queue.length > 0) {
        const current = queue.shift();
        groupPieces.push(current);

        pieces.forEach((candidate) => {
          if (visited.has(candidate)) {
            return;
          }

          if (this.arePiecesConnected(current, candidate)) {
            visited.add(candidate);
            queue.push(candidate);
          }
        });
      }

      groups.push({
        pieces: groupPieces,
        mass: this.getCargoGroupMass(groupPieces),
      });
    });

    return groups;
  }

  getCargoGroupState(pieces) {
    const states = pieces
      .map((piece) => piece.getData("cargoSwayState"))
      .filter((state) => state && Number.isFinite(state.offsetX) && Number.isFinite(state.velocityX));

    if (states.length === 0) {
      return { offsetX: 0, velocityX: 0 };
    }

    return {
      offsetX: states.reduce((sum, state) => sum + state.offsetX, 0) / states.length,
      velocityX: states.reduce((sum, state) => sum + state.velocityX, 0) / states.length,
    };
  }

  getCargoGroupMass(pieces) {
    return pieces.reduce((sum, piece) => {
      return sum + (piece.getData("frozen") ? 1.35 : 1);
    }, 0);
  }

  translateCargoGroup(group, moveX) {
    group.pieces.forEach((piece) => {
      this.translateCargoPiece(piece, moveX);
    });
  }

  translateCargoPiece(piece, moveX) {
    if (!piece || !piece.body || moveX === 0) {
      return;
    }

    const MatterBody = Phaser.Physics.Matter.Matter.Body;
    const velocityY = piece.body.velocity ? piece.body.velocity.y : 0;

    MatterBody.translate(piece.body, { x: moveX, y: 0 }, false);
    MatterBody.setVelocity(piece.body, { x: 0, y: velocityY });
  }

  arePiecesConnected(pieceA, pieceB) {
    const partsA = this.getCollisionParts(pieceA.body);
    const partsB = this.getCollisionParts(pieceB.body);
    const tolerance = this.cargoConnectionTolerance;

    return partsA.some((partA) => {
      return partsB.some((partB) => this.arePartBoundsAdjacent(partA.bounds, partB.bounds, tolerance));
    });
  }

  arePartBoundsAdjacent(boundsA, boundsB, tolerance) {
    const overlapX = Math.min(boundsA.max.x, boundsB.max.x) - Math.max(boundsA.min.x, boundsB.min.x);
    const overlapY = Math.min(boundsA.max.y, boundsB.max.y) - Math.max(boundsA.min.y, boundsB.min.y);
    const touchLeftRight = Math.abs(boundsA.max.x - boundsB.min.x) <= tolerance || Math.abs(boundsB.max.x - boundsA.min.x) <= tolerance;
    const touchTopBottom = Math.abs(boundsA.max.y - boundsB.min.y) <= tolerance || Math.abs(boundsB.max.y - boundsA.min.y) <= tolerance;

    if (overlapX > 1 && overlapY > 1) {
      return true;
    }

    return (touchLeftRight && overlapY > 2) || (touchTopBottom && overlapX > 2);
  }

  resolveCarriedGroupOverlaps(groups) {
    for (let pass = 0; pass < 4; pass += 1) {
      let resolved = false;

      for (let i = 0; i < groups.length; i += 1) {
        for (let j = i + 1; j < groups.length; j += 1) {
          const separationX = this.getCargoGroupSeparationX(groups[i], groups[j]);

          if (separationX === 0) {
            continue;
          }

          const massA = Math.max(groups[i].mass, 1);
          const massB = Math.max(groups[j].mass, 1);
          const totalMass = massA + massB;
          const moveA = separationX * (massB / totalMass);
          const moveB = -separationX * (massA / totalMass);

          this.translateCargoGroup(groups[i], moveA);
          this.translateCargoGroup(groups[j], moveB);
          resolved = true;
        }
      }

      if (!resolved) {
        return;
      }
    }
  }

  getCargoGroupSeparationX(groupA, groupB) {
    let maxOverlapX = 0;
    const partsA = groupA.pieces.flatMap((piece) => this.getCollisionParts(piece.body));
    const partsB = groupB.pieces.flatMap((piece) => this.getCollisionParts(piece.body));

    partsA.forEach((partA) => {
      partsB.forEach((partB) => {
        const overlap = this.getPartOverlap(partA, partB);

        if (overlap && overlap.y > 1) {
          maxOverlapX = Math.max(maxOverlapX, overlap.x);
        }
      });
    });

    if (maxOverlapX <= 0) {
      return 0;
    }

    const centerA = this.getCargoGroupCenterX(groupA);
    const centerB = this.getCargoGroupCenterX(groupB);
    const directionForA = centerA <= centerB ? -1 : 1;

    return directionForA * (maxOverlapX + this.cargoOverlapPadding);
  }

  getCargoGroupCenterX(group) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;

    group.pieces.forEach((piece) => {
      minX = Math.min(minX, piece.body.bounds.min.x);
      maxX = Math.max(maxX, piece.body.bounds.max.x);
    });

    return (minX + maxX) / 2;
  }

  freezePiece(piece) {
    const MatterBody = Phaser.Physics.Matter.Matter.Body;

    if (!piece || piece.getData("frozen")) {
      return;
    }

    piece.setData("frozen", true);
    this.landedPieces = this.landedPieces.filter((landedPiece) => landedPiece !== piece);

    if (piece.body) {
      MatterBody.setVelocity(piece.body, { x: 0, y: 0 });
      MatterBody.setAngularVelocity(piece.body, 0);
      MatterBody.setStatic(piece.body, true);
      this.configureBodyForCollision(piece.body);
    }

    // 冻结后的鱼块保持纯色底面，同时显示白色裂纹。
    const cellRects = piece.getData("cellRects") || [];
    const frostMarks = piece.getData("frostMarks") || [];

    cellRects.forEach((cell) => {
      if (!cell || typeof cell.setAlpha !== "function") {
        return;
      }

      cell.setAlpha(0.9);
    });

    frostMarks.forEach((mark) => {
      if (!mark || typeof mark.setVisible !== "function") {
        return;
      }

      mark.setVisible(true);
      mark.setAlpha(1);
    });

    if (this.currentFish && this.currentFish.gameObject === piece) {
      this.currentFish.frozen = true;
    }

    if (!this.frozenPieces.includes(piece)) {
      this.frozenPieces.push(piece);
    }
  }

  checkCurrentFishFallOut() {
    if (!this.currentFish || !this.currentFish.falling) {
      return;
    }

    const fish = this.currentFish.gameObject;

    // 只有整块冻鱼已经掉出游戏区底部，才视为跌落。
    // 侧面蹭到车或鱼堆时仍然保留 Matter 物理交互，让它自然滑动、倾倒或被接住。
    if (fish.body.bounds.min.y > this.worldBottomY) {
      this.markCurrentFishDestroyed();
    }
  }

  markCurrentFishDestroyed() {
    if (!this.currentFish || !this.currentFish.falling) {
      return;
    }

    const fish = this.currentFish.gameObject;

    this.currentFish.destroyed = true;
    this.currentFish.falling = false;
    this.currentFish.landed = true;
    fish.setData("destroyed", true);
    fish.setData("falling", false);
    fish.setData("landed", true);
    this.loseLife();

    // 跌落的鱼块不应该继续作为鱼堆参与碰撞，否则会出现挂边、抖动和误碰撞。
    if (fish.body) {
      this.matter.world.remove(fish.body);
    }

    fish.destroy();
    if (this.isGameOver) {
      return;
    }

    this.scheduleNextFishBlock();
  }

  scheduleNextFishBlock() {
    if (this.isSpawnScheduled) {
      return;
    }

    this.isSpawnScheduled = true;

    // landed 后稍等一下再生成下一块，避免同一次物理接触重复生成。
    this.nextSpawnEvent = this.time.delayedCall(this.spawnDelayMs, () => {
      if (this.currentFish && this.currentFish.falling) {
        this.isSpawnScheduled = false;
        this.nextSpawnEvent = null;
        return;
      }

      this.createFallingFishBlock();
    });
  }

  getCarSupportRects() {
    const baseTop = this.car.y - this.carBaseHeight / 2;
    const railTop = baseTop - this.carRailHeight;
    const leftRailLeft = this.car.x - this.carWidth / 2;
    const leftRailRight = leftRailLeft + this.carRailWidth;
    const rightRailRight = this.car.x + this.carWidth / 2;
    const rightRailLeft = rightRailRight - this.carRailWidth;

    // 每个矩形都代表车上一个可以承接鱼块的实体部件。
    return [
      {
        left: this.car.x - this.carWidth / 2,
        right: this.car.x + this.carWidth / 2,
        top: baseTop,
      },
      {
        left: leftRailLeft,
        right: leftRailRight,
        top: railTop,
      },
      {
        left: rightRailLeft,
        right: rightRailRight,
        top: railTop,
      },
    ];
  }

  getBoundsHorizontalOverlap(boundsA, boundsB) {
    const overlapLeft = Math.max(boundsA.min.x, boundsB.min.x);
    const overlapRight = Math.min(boundsA.max.x, boundsB.max.x);

    return Math.max(0, overlapRight - overlapLeft);
  }

  rotateCurrentFish() {
    if (!this.currentFish || !this.currentFish.falling) {
      return;
    }

    const fish = this.currentFish.gameObject;
    const MatterBody = Phaser.Physics.Matter.Matter.Body;

    // 顺时针旋转 90 度。
    // 视觉 Container 和它绑定的单个 Matter 矩形 body 会一起旋转。
    const rotateAngle = Phaser.Math.DegToRad(90);

    if (!this.canRotateFish(fish, rotateAngle)) {
      return;
    }

    MatterBody.rotate(fish.body, rotateAngle);
    this.currentSpawnBeamWidth = this.getBodyWidth(fish.body);
    this.positionSpawnBeam(this.currentSpawnX || fish.x);
    this.rememberCurrentFishPreviousBounds();
  }

  canRotateFish(fish, rotateAngle) {
    if (!fish || !fish.body) {
      return false;
    }

    const MatterBody = Phaser.Physics.Matter.Matter.Body;

    MatterBody.rotate(fish.body, rotateAngle);
    const isLegal = this.isFishPlacementLegal(fish);
    MatterBody.rotate(fish.body, -rotateAngle);

    return isLegal;
  }

  isFishPlacementLegal(fish) {
    if (!fish || !fish.body) {
      return false;
    }

    const bounds = fish.body.bounds;

    if (
      bounds.min.x < this.getMainCameraVisibleLeftX() ||
      bounds.max.x > this.getMainCameraVisibleRightX()
    ) {
      return false;
    }

    if (bounds.max.y > this.worldBottomY) {
      return false;
    }

    return !this.doesFishOverlapStaticSupports(fish);
  }

  doesFishOverlapStaticSupports(fish) {
    const supportParts = this.getStaticSupportParts();
    const fishParts = this.getCollisionParts(fish.body);

    return fishParts.some((fishPart) => {
      return supportParts.some((supportPart) => this.getPartOverlap(fishPart, supportPart) !== null);
    });
  }

  getBodyWidth(body) {
    if (!body || !body.bounds) {
      return this.spawnBeamWidth;
    }

    return body.bounds.max.x - body.bounds.min.x;
  }

  applyFallingSpeedControl() {
    if (!this.currentFish || !this.currentFish.falling) {
      return;
    }

    const fish = this.currentFish.gameObject;

    if (!fish || !fish.body) {
      return;
    }

    const MatterBody = Phaser.Physics.Matter.Matter.Body;
    const isKeyboardDropDown =
      this.keys && (this.keys.dropZ.isDown || this.keys.dropQ.isDown);
    const targetSpeed = this.isDropButtonHeld || isKeyboardDropDown
      ? this.fastDropSpeed
      : this.fallingSpeed;

    // falling 阶段不走自由落体加速度，而是像参考实现一样由游戏逻辑锁定匀速下落。
    // 全局 Matter 重力仍然保留给 landed 的动态鱼块，所以这里每帧重置当前块速度和残余力。
    MatterBody.setVelocity(fish.body, { x: 0, y: targetSpeed });
    fish.body.force.x = 0;
    fish.body.force.y = 0;
  }

  getMoveDirection() {
    let direction = 0;
    const pointer = this.input.activePointer;

    if (
      pointer.isDown &&
      pointer.y < this.gameViewHeight &&
      !this.isPointerOnRotateButton(pointer) &&
      !this.isPointerOnDropButton(pointer)
    ) {
      // pointer.x 是指针在 Phaser 画布里的横坐标。
      // 小于屏幕中线表示左侧，大于等于中线表示右侧。
      direction += pointer.x < this.scale.width / 2 ? -1 : 1;
    }

    if (this.keys.left.isDown || this.keys.cursorLeft.isDown) {
      direction -= 1;
    }

    if (this.keys.right.isDown || this.keys.cursorRight.isDown) {
      direction += 1;
    }

    // 同时按左右时互相抵消；最终只返回 -1、0、1。
    return Phaser.Math.Clamp(direction, -1, 1);
  }

  isPointerOnRotateButton(pointer) {
    return this.isPointerOnScreenButton(pointer, this.rotateButton);
  }

  isPointerOnDropButton(pointer) {
    return this.isPointerOnScreenButton(pointer, this.dropButton);
  }

  isPointerOnScreenButton(pointer, button) {
    if (!button) {
      return false;
    }

    const screenX = button.getData("screenX");
    const screenY = button.getData("screenY");
    const screenWidth = button.getData("screenWidth");
    const screenHeight = button.getData("screenHeight");
    const left = screenX - screenWidth / 2;
    const right = screenX + screenWidth / 2;
    const top = screenY - screenHeight / 2;
    const bottom = screenY + screenHeight / 2;

    // pointer.x / pointer.y 是屏幕坐标，不是 Matter 世界坐标。
    // 所以这里直接和按钮记录的屏幕矩形比较，避免相机缩放影响输入判断。
    return pointer.x >= left && pointer.x <= right && pointer.y >= top && pointer.y <= bottom;
  }

  updateTargetX(direction, delta) {
    const seconds = delta / 1000;

    // 输入只改变 targetX，不直接改车子的真实位置。
    // 这样点击/按住屏幕时，车子会追赶目标点，而不是瞬间跳过去。
    this.targetX += direction * this.targetMoveSpeed * seconds;
    this.targetX = this.clampCarX(this.targetX);
  }

  updateCarFrictionMode(inputDirection) {
    const direction = inputDirection === 0 ? 0 : Math.sign(inputDirection);
    const now = this.time ? this.time.now : 0;

    if (
      direction !== 0 &&
      this.lastNonZeroInputDirection !== 0 &&
      direction !== this.lastNonZeroInputDirection &&
      now - this.lastNonZeroInputTime <= this.inputTurnWindowMs
    ) {
      this.shakeForceDirection = this.lastNonZeroInputDirection;
      this.shakeForceTimerMs = this.shakeForceDurationMs;
    }

    if (direction !== 0) {
      this.lastNonZeroInputDirection = direction;
      this.lastNonZeroInputTime = now;
    }

    this.setCarFriction(this.carNoFriction);
    this.updateLandedFrictionMode(this.landedNoFriction);
  }

  applyShakeForce(delta) {
    if (this.shakeForceTimerMs <= 0 || this.shakeForceDirection === 0) {
      return;
    }

    const carConnectedPieces = this.getCarConnectedPieces();

    this.getCarriedPieces().forEach((piece) => {
      if (!this.isShakeAffectedPiece(piece, carConnectedPieces)) {
        return;
      }

      this.applyDistributedShakeForce(piece, this.shakeForceDirection);
    });

    this.shakeForceTimerMs = Math.max(0, this.shakeForceTimerMs - delta);

    if (this.shakeForceTimerMs === 0) {
      this.shakeForceDirection = 0;
    }
  }

  isShakeAffectedPiece(piece, carConnectedPieces) {
    return (
      piece &&
      piece.active &&
      piece.body &&
      piece.getData("landed") === true &&
      piece.getData("falling") !== true &&
      (piece.getData("frozen") !== true || !carConnectedPieces.has(piece))
    );
  }

  applyDistributedShakeForce(piece, direction) {
    if (!piece || !piece.body || direction === 0) {
      return;
    }

    const MatterBody = Phaser.Physics.Matter.Matter.Body;
    const forcePoints = this.getShakeSideForcePoints(piece, direction);

    if (forcePoints.length === 0) {
      return;
    }

    if (piece.getData("frozen") === true && piece.body.isStatic) {
      MatterBody.setStatic(piece.body, false);
      this.configureBodyForCollision(piece.body);
    }

    const forceScale = this.isIcePiece(piece) ? this.iceShakeForceScale : 1;
    const forcePerPoint = {
      x: (this.shakeForce * forceScale * direction) / forcePoints.length,
      y: 0,
    };

    forcePoints.forEach((point) => {
      MatterBody.applyForce(piece.body, point, forcePerPoint);
    });
  }

  getShakeSideForcePoints(piece, direction) {
    const verticalEdges = this.getCollisionParts(piece.body)
      .flatMap((part) => this.getPartFaceEdges(part))
      .filter((edge) => Math.abs(edge.end.y - edge.start.y) >= this.fishVisualSize * 0.35);

    if (verticalEdges.length === 0) {
      return [];
    }

    const targetX = direction < 0
      ? Math.min(...verticalEdges.map((edge) => (edge.start.x + edge.end.x) / 2))
      : Math.max(...verticalEdges.map((edge) => (edge.start.x + edge.end.x) / 2));
    const sideTolerance = this.fishVisualSize * 0.3;
    const sideEdges = verticalEdges.filter((edge) => {
      const centerX = (edge.start.x + edge.end.x) / 2;
      return Math.abs(centerX - targetX) <= sideTolerance;
    });

    return sideEdges.flatMap((edge) => {
      return [0.25, 0.5, 0.75].map((ratio) => ({
        x: edge.start.x + (edge.end.x - edge.start.x) * ratio,
        y: edge.start.y + (edge.end.y - edge.start.y) * ratio,
      }));
    });
  }

  getCarConnectedPieces(pieces = this.getCarriedPieces()) {
    const connected = new Set();
    const queue = [];

    pieces.forEach((piece) => {
      if (this.isPieceDirectlyConnectedToCar(piece)) {
        connected.add(piece);
        queue.push(piece);
      }
    });

    while (queue.length > 0) {
      const current = queue.shift();

      pieces.forEach((candidate) => {
        if (connected.has(candidate)) {
          return;
        }

        if (this.arePiecesConnected(current, candidate)) {
          connected.add(candidate);
          queue.push(candidate);
        }
      });
    }

    return connected;
  }

  isPieceDirectlyConnectedToCar(piece) {
    if (!piece || !piece.body) {
      return false;
    }

    const pieceParts = this.getCollisionParts(piece.body);
    const carParts = this.carParts
      .filter((part) => part && part.active && part.body)
      .flatMap((part) => this.getCollisionParts(part.body));
    const tolerance = this.cargoConnectionTolerance + this.landingSeparation + 0.5;

    return pieceParts.some((piecePart) => {
      return carParts.some((carPart) => this.arePartBoundsAdjacent(piecePart.bounds, carPart.bounds, tolerance));
    });
  }

  setCarFriction(friction) {
    this.carParts.forEach((part) => {
      if (!part || !part.body) {
        return;
      }

      this.forEachBodyPart(part.body, (bodyPart) => {
        bodyPart.friction = friction;
        bodyPart.frictionStatic = friction;
      });
    });
  }

  updateLandedFrictionMode(friction) {
    this.landedPieces.forEach((piece) => {
      this.setFishFriction(piece, friction);
    });
  }

  setFishFriction(fish, friction) {
    if (!fish || !fish.body) {
      return;
    }

    this.forEachBodyPart(fish.body, (bodyPart) => {
      bodyPart.friction = friction;
      bodyPart.frictionStatic = friction;
    });
  }

  applyCarSmoothing(delta) {
    const MatterBody = Phaser.Physics.Matter.Matter.Body;
    const frameScale = delta / (1000 / 60);
    const smoothing = 1 - Math.pow(1 - this.carSmoothing, frameScale);
    const nextX = this.car.x + (this.targetX - this.car.x) * smoothing;
    const clampedNextX = this.clampCarX(nextX);
    const moveX = clampedNextX - this.car.x;

    // 车子仍然是 Matter body，但水平移动由外部目标位置控制。
    // 注意：这里不是瞬间对齐输入坐标，也没有用 velocity 驱动；
    // 每帧只把车子沿 x 轴推进一小段，让它平滑追赶 targetX。
    // 伪物理版里车不再把 Matter 碰撞反作用力传给砖块。
    this.carParts.forEach((part) => {
      MatterBody.translate(part.body, { x: moveX, y: 0 }, true);
    });

    return moveX;
  }

  clampCarX(x) {
    const catchHalfWidth = this.fishCellSize * 2;
    const leftmostSpawnX = this.spawnTracks.length > 0
      ? Math.min(...this.spawnTracks)
      : this.getMainCameraVisibleLeftX() + catchHalfWidth;
    const rightmostSpawnX = this.spawnTracks.length > 0
      ? Math.max(...this.spawnTracks)
      : this.getMainCameraVisibleRightX() - catchHalfWidth;
    const leftCatchX = leftmostSpawnX - catchHalfWidth;
    const rightCatchX = rightmostSpawnX + catchHalfWidth;
    const cargoBounds = this.getCarAndLandedCargoBounds();
    const leftOffset = cargoBounds.left - this.car.x;
    const rightOffset = cargoBounds.right - this.car.x;

    // 允许车和已落地货物整体探出屏幕，只要整体边缘还能接住最边缘轨道的最长鱼块。
    return Phaser.Math.Clamp(
      x,
      leftCatchX - rightOffset,
      rightCatchX - leftOffset
    );
  }

  getCarAndLandedCargoBounds() {
    let left = this.car ? this.car.x - this.carWidth / 2 : 0;
    let right = this.car ? this.car.x + this.carWidth / 2 : 0;

    this.getCarriedPieces().forEach((piece) => {
      left = Math.min(left, piece.body.bounds.min.x);
      right = Math.max(right, piece.body.bounds.max.x);
    });

    return { left, right };
  }
}
