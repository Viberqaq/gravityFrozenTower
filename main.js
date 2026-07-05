const config = {
  type: Phaser.AUTO,
  width: 720,
  height: 960,
  backgroundColor: "#d6b363",
  parent: document.body,
  physics: {
    default: "matter",
    matter: {
      gravity: {
        y: 1,
      },
      positionIterations: 16,
      velocityIterations: 12,
      enableSleeping: false,
      debug: false,
    },
  },
  scene: [GameScene],
};

new Phaser.Game(config);
