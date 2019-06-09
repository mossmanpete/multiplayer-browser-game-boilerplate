import * as BABYLON from 'babylonjs';
import * as GUI from 'babylonjs-gui';
import * as Colyseus from 'colyseus.js';

import Scene, { ISceneEventArgs } from '../components/Scene';
import { Lights } from './Lights';
import { Pickup } from './Pickup';
import { Area } from './Area';
import { Player } from './Player';
import { Rival } from './Rival';
import { RouterService } from './routing/routerService';
import { GAME_ASSETS_URL, SKYBOX_TEXTURES_URL } from './constants';
import { createVector } from './utils';

BABYLON.ParticleHelper.BaseAssetsUrl = `${process.env.PUBLIC_URL}/assets/`;
// BABYLON.Constants.PARTICLES_BaseAssetsUrl = ''

export enum PrefabID {
  PICKUP = 'Barrel_WideS',
  PLAYER = 'YBot',
  CORRIDOR = 'Corridor',
  CORRIDOR_4 = 'Corridor4',
  CORRIDOR_T = 'CorridorT',
  CORRIDOR_L = 'CorridorL',
}

export class Game {
  private canvas: HTMLCanvasElement;
  private engine: BABYLON.Engine;
  private scene: BABYLON.Scene;

  private prefabs: { [id: string]: BABYLON.Mesh } = {};
  private lights: Lights;
  private player!: Player;
  private rivals: { [id: string]: Rival } = {};
  private area: Area;
  private pickups: { [id: string]: Pickup } = {};

  private advancedTexture: GUI.AdvancedDynamicTexture;
  private assetsManager: BABYLON.AssetsManager;

  private router: RouterService;

  private setTaskInProgress: () => void;
  private removeTaskInProgress: () => void;

  constructor(
    args: ISceneEventArgs,
    client: Colyseus.Client,
    setTaskInProgress: () => void,
    removeTaskInProgress: () => void
  ) {
    this.canvas = args.canvas as HTMLCanvasElement;
    this.engine = args.engine;
    this.scene = args.scene;

    this.router = new RouterService(client);

    this.lights = new Lights(this.scene);
    this.area = new Area(this.scene);

    this.advancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI('ui', true, this.scene);
    this.assetsManager = new BABYLON.AssetsManager(this.scene);

    this.setTaskInProgress = setTaskInProgress;
    this.removeTaskInProgress = removeTaskInProgress;
  }

  private createMeshTask(taskId: string, fileName: string) {
    // console.log('creating task', taskId);
    return this.assetsManager.addMeshTask(taskId, '', GAME_ASSETS_URL, fileName);
  }

  private storePrefab(prefabName: string, task: BABYLON.MeshAssetTask) {
    // console.log('storing prefab', prefabName);
    const prefabMesh = task.loadedMeshes.find(mesh => mesh.id === prefabName) as BABYLON.Mesh;
    prefabMesh.getChildMeshes(true).forEach(child => (child.isVisible = false));
    prefabMesh.setEnabled(false);
    this.prefabs[prefabName] = prefabMesh;
  }

  private storePlayerPrefab(task: BABYLON.MeshAssetTask) {
    const prefabMesh = task.loadedMeshes.find(
      mesh => mesh.name === PrefabID.PLAYER
    ) as BABYLON.Mesh;
    prefabMesh.getChildMeshes(true).forEach(child => child.setEnabled(false));
    prefabMesh.setEnabled(false);
    this.prefabs[PrefabID.PLAYER] = prefabMesh;
  }

  load() {
    // this.scene.debugLayer.show();
    this.scene.gravity = new BABYLON.Vector3(0, -5, 0);
    this.scene.collisionsEnabled = true;
    this.scene.actionManager = new BABYLON.ActionManager(this.scene);
    const skyboxTexture = new BABYLON.CubeTexture(SKYBOX_TEXTURES_URL, this.scene, [
      '_left.png',
      '_up.png',
      '_front.png',
      '_right.png',
      '_down.png',
      '_back.png',
    ]);
    this.scene.createDefaultSkybox(skyboxTexture, false, 1000);

    const corridor4Task = this.createMeshTask('corridor4', 'corridor4.babylon');
    const corridorTask = this.createMeshTask('corridor', 'corridorNormal.babylon');
    const corridorTTask = this.createMeshTask('corridorT', 'corridorT.babylon');
    const corridorLTask = this.createMeshTask('corridorL', 'corridorL.babylon');
    const pickupTask = this.createMeshTask('pickup', 'pickup.babylon');
    const playerTask = this.createMeshTask('player', 'player.babylon');

    corridor4Task.onSuccess = task => this.storePrefab(PrefabID.CORRIDOR_4, task);
    corridorTask.onSuccess = task => this.storePrefab(PrefabID.CORRIDOR, task);
    corridorTTask.onSuccess = task => this.storePrefab(PrefabID.CORRIDOR_T, task);
    corridorLTask.onSuccess = task => this.storePrefab(PrefabID.CORRIDOR_L, task);
    pickupTask.onSuccess = task => this.storePrefab(PrefabID.PICKUP, task);
    playerTask.onSuccess = task => this.storePlayerPrefab(task);

    this.assetsManager.onFinish = tasks => {
      console.log(tasks);
      this.router.connect(this, 'game');
    };
  }

  initGameStateAndRun(levelConfig: any) {
    this.area.init(levelConfig.corridors, this.prefabs);
    this.lights.init(levelConfig.lights);
    levelConfig.pickups.forEach((pickupConfig: any) => {
      const newPickup = new Pickup(this.scene, pickupConfig.id, this.prefabs[PrefabID.PICKUP]);
      newPickup.init(this.lights, createVector(pickupConfig.position));
      this.pickups[newPickup.id] = newPickup;
    });
    this.player = new Player(this.scene, this.router.room.sessionId);
    this.player.init(createVector(levelConfig.spawnPoint));
    this.setupPlayerActions();
    this.run();
  }

  private run() {
    this.scene.executeWhenReady(() => {
      this.engine.runRenderLoop(() => {
        this.player.sendMovement(this.router);
        this.scene.render();
      });
    });
  }

  start() {
    this.assetsManager.load();
  }

  private setupPlayerActions() {
    const actionManager = this.player.getActionManager();
    Object.keys(this.pickups).forEach(key => {
      actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(
          {
            trigger: BABYLON.ActionManager.OnIntersectionEnterTrigger,
            parameter: this.pickups[key].solveAreaBox,
          },
          () => {
            this.advancedTexture.addControl(this.pickups[key].label);
            this.pickups[key].label.linkWithMesh(this.pickups[key].pickupMesh);
            this.player.inSolvingAreaOf = this.pickups[key];
          }
        )
      );
      actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(
          {
            trigger: BABYLON.ActionManager.OnIntersectionExitTrigger,
            parameter: this.pickups[key].solveAreaBox,
          },
          () => {
            this.advancedTexture.removeControl(this.pickups[key].label);
            this.player.inSolvingAreaOf = undefined;
            this.removeTaskInProgress();
          }
        )
      );
      this.scene.actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(
          {
            trigger: BABYLON.ActionManager.OnKeyUpTrigger,
            parameter: ' ',
          },
          () => {
            this.setTaskInProgress();
          },
          new BABYLON.PredicateCondition(this.scene.actionManager as BABYLON.ActionManager, () => {
            return !!this.player.inSolvingAreaOf;
          })
        )
      );
    });
  }

  addPlayer(key: string, position: BABYLON.Vector3) {
    const newRival = new Rival(this.scene, this.prefabs[PrefabID.PLAYER], key);
    newRival.init(position);
    this.rivals[key] = newRival;
  }

  updatePlayer(key: string, position: BABYLON.Vector3) {
    if (key === this.player.id) {
      position.y = 2;
      this.player.update(position);
    }
    if (this.rivals[key]) {
      this.rivals[key].update(position);
    }
  }
}