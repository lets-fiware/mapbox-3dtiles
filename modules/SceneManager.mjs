import * as THREE from 'three';

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

import Highlight from './Highlight.mjs';
import Marker from './Marker.mjs';
import CameraSync from './CameraSync.mjs';
import FeatureInfo from './FeatureInfo.mjs';

let instance = null;

class SceneManager {

    constructor(map, dracoLoader) {
        if (instance) {
            return instance;
        }

        this._setup(map, dracoLoader);
        instance = this;
    }

    _setup(map, dracoLoader) {
        this.map = map;
        this.gl = this.map._canvas.getContext('webgl');
        this.tilesets = [];
        this.camera = this._createCamera();
        this.lights = this._createLight();
        this.world = this._createWorld();
        this.scene = this._createScene(this.world, this.lights);
        this.renderer = this._createRenderer();
        this.shadowMaterial = this._createShadowMaterial();
        this.shadowPlane = this._createShadowPlane(this.shadowMaterial);
        this.loader = this._createLoader(dracoLoader);
        this.cameraSync = this._createCameraSync(this.map, this.camera, this.world);
        this.featureInfo = new FeatureInfo(this.scene, this.map, this.camera, this.loader);
        this.highlight = new Highlight(this.scene, this.map);

        this.addShadow();

        window.addEventListener('resize', (e) => {
            this._resize(e);
        });
    }

    addTileset(tileset) {
        this.world.add(tileset.root.totalContent);
        this.tilesets.push(tileset);
        this.cameraSync.updateCamera();
    }

    removeTileset(tileset) {
        this.world.remove(tileset.root.totalContent);
        let position = this.tilesets.indexOf(tileset);
        this.layers.splice(position, 1);
    }

    queryRenderedFeatures(geometry, options, result) {
        if (!this.map || !this.map.transform) {
            return result;
        }

        if (geometry && geometry.x && geometry.y) {
            result = this.featureInfo.getAt(result, geometry.x, geometry.y);
        }

        return result;
    }

    addShadow() {
        this.scene.add(this.shadowPlane);
    }

    removeShadow() {
        this.scene.remove(this.shadowPlane);
    }

    setShadowOpacity(opacity) {
        const newOpacity = opacity < 0 ? 0.0 : opacity > 1 ? 1.0 : opacity;
        this.shadowMaterial.opacity = newOpacity;
    }

    setHemisphereIntensity(intensity) {
        if (this.lights[0] instanceof THREE.HemisphereLight) {
            const newIntensity = intensity < 0 ? 0.0 : intensity > 1 ? 1.0 : intensity;
            this.lights[0].intensity = newIntensity;
        }
    }

    _createCamera() {
        const camera = new THREE.PerspectiveCamera(0, 0, 0, 0);
        return camera;
    }

    _createCameraSync(map, camera, world) {
        const cameraSync = new CameraSync(map, camera, world);
        cameraSync.aspect = window.innerWidth / window.innerHeight;
        cameraSync.updateCallback = () => this._loadVisibleTiles();
        camera.updateProjectionMatrix();

        return cameraSync;
    }

    _createWorld() {
        const world = new THREE.Group();
        return world;
    }

    _createScene(world, light) {
        const scene = new THREE.Scene();
        light.forEach((light) => {
            scene.add(light);
        });

        scene.add(world);
        return scene;
    }

    _createRenderer(gl) {
        const renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            canvas: this.map.getCanvas(),
            context: gl
        });

        renderer.autoClear = false;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;

        return renderer;
    }

    _createLoader(dracoLoader) {
        const loader = new GLTFLoader();

        if (dracoLoader) {
            loader.setDRACOLoader(dracoLoader);
        }

        var ktx2loader = new KTX2Loader();
        loader.setKTX2Loader(ktx2loader);

        return loader;
    }

    _createLight() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0xbebebe, 0.7);
        const dirLight = this._getDefaultDirLight(width, height);

        return [hemiLight, dirLight];
    }

    _getDefaultDirLight(width, height) {
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
        dirLight.color.setHSL(0.1, 1, 0.95);
        dirLight.position.set(-1, -1.75, 1);
        dirLight.position.multiplyScalar(100);
        dirLight.castShadow = true;
        dirLight.shadow.camera.near = -10000;
        dirLight.shadow.camera.far = 2000000;
        dirLight.shadow.bias = 0.0038;
        dirLight.shadow.mapSize.width = width;
        dirLight.shadow.mapSize.height = height * 2.5;
        dirLight.shadow.camera.left = -width;
        dirLight.shadow.camera.right = width;
        dirLight.shadow.camera.top = -height * 2.5;
        dirLight.shadow.camera.bottom = height * 2.5;
        dirLight.uuid = 'shadowlight';

        return dirLight;
    }

    _createShadowMaterial() {
        const shadowMaterial = new THREE.ShadowMaterial();
        shadowMaterial.opacity = 0.09;

        return shadowMaterial;
    }

    _createShadowPlane(shadowMaterial) {
        var planeGeometry = new THREE.PlaneBufferGeometry(10000, 10000, 1, 1);
        const shadowPlane = new THREE.Mesh(planeGeometry, shadowMaterial);
        shadowPlane.receiveShadow = true;

        return shadowPlane;
    }

    async _loadVisibleTiles() {
        for (let i = 0; i < this.tilesets.length; i++) {
            const tileset = this.tilesets[i];
            if (tileset && tileset.root) {
                await tileset.root.checkLoad(this.cameraSync.frustum, this.cameraSync.cameraPosition, tileset.geometricError);
            }
        }
    }

    _resize(e) {
        if (!this.renderer) {
            return;
        }

        let width = window.innerWidth;
        let height = window.innerHeight;
        this.renderer.setSize(width, height);

        for (let i = 0; i < this.scene.children.length; i++) {
            let c = this.scene.children[i];
            if (c.uuid === 'shadowlight') {
                c = this._getDefaultDirLight(width, height);
            }
        }
    }

    render() {
        // this._updateMarkers();
        this.renderer.state.reset();
        this.renderer.render(this.scene, this.camera);
    }

        /* _updateMarkers() {
        const markers = this.marker.getMarkers();
        for (let i = 0; i < markers.length; i++) {
            markers[i].renderer.render(markers[i].marker, this.camera);
            markers[i].renderer.domElement.style = 'position: absolute; top: 0; pointer-events: none;';

            for (let j = 0; j < markers[i].renderer.domElement.children.length; j++) {
                const child = markers[i].renderer.domElement.children[j];
                child.style = 'pointer-events: auto;';
                child.transform.baseVal[0].matrix.e -= child.firstChild.width.baseVal.value / 2;
                child.transform.baseVal[0].matrix.f -= child.firstChild.height.baseVal.value / 2;
            }
        }
    } */
}

export default SceneManager;