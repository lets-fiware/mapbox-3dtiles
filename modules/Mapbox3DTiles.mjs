import * as THREE from 'three';

import Subsurface from './Subsurface.mjs';
import FeatureInfo from './FeatureInfo.mjs';
import TileSet from './TileSet.mjs';
import Highlight from './Highlight.mjs';
import Marker from './Marker.mjs';
import applyStyle from './Styler.mjs'
import SceneManager from './SceneManager'

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export class Mapbox3DTilesLayer {
    constructor(params) {
        if (!params) throw new Error('parameters missing for mapbox 3D tiles layer');
        if (!params.id) throw new Error('id parameter missing for mapbox 3D tiles layer');

        (this.id = params.id), (this.url = params.url);
        this.styleParams = {};
        this.projectToMercator = params.projectToMercator ? params.projectToMercator : false;
        this.lights = params.lights ? params.lights : this._getDefaultLights();
        this.dracoLoader = params.dracoLoader;
        this.subsurfaceLayer = params.subsurface ? params.subsurface : false;

        if ('color' in params) this.styleParams.color = params.color;
        if ('opacity' in params) this.styleParams.opacity = params.opacity;
        if ('pointsize' in params) this.styleParams.pointsize = params.pointsize;

        this.style = params.style || this.styleParams; //styleparams to be replaced by style config
        this.loadStatus = 0;
        this.type = 'custom';
        this.renderingMode = '3d';

        window.addEventListener('resize', (e) => {
            this._resize(e);
        });
    }

    _addSubsurfaceSupport() {
        this.subsurface = new Subsurface(this.scene, this.world, this.cameraSync);
    }

    _getDefaultLights() {
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

    logChildNodes(node) {
        const children = node.children.filter(child=>child.inView);
        if (children.length) {
            const result = []
            for (const child of children) {
                result.push({
                    loaded: child.loaded,
                    geometricError: child.geometricError,
                    content: child.content && child.content.uri.split('/').pop(),
                    children: this.logChildNodes(child)
                })
            }
            return result
        }
    }

    logTileset() {
        let result = []
        result.push({
            url: this.tileset.url,
            geometricEror: this.tileset.geometricError,
            children: this.logChildNodes(this.tileset.root)
        })
        console.log(JSON.stringify(result));
    }

    async loadVisibleTiles(cameraFrustum, cameraPosition) {
        if (this.tileset && this.tileset.root) {
            await this.tileset.root.checkLoad(cameraFrustum, cameraPosition, this.tileset.geometricError);
        }
    }

    onAdd(map, gl) {
        this.map = map;
        this.sceneManager = new SceneManager(map);
        this.world = this._createWorld("flatMercatorWorld");
       

        this.mapQueryRenderedFeatures = map.queryRenderedFeatures.bind(this.map);
        this.map.queryRenderedFeatures = this.queryRenderedFeatures.bind(this);
        this.camera = this.sceneManager.camera;
        
        this.scene = this._createScene(this.world);
        this.renderer = this._createRenderer(gl);

        this.loader = this._createLoader();
        this.featureInfo = new FeatureInfo(this.world, this.map, this.camera, this.id, this.url, this.loader);
        this.highlight = new Highlight(this.scene, this.map);
        this.marker = new Marker(this.scene, this.map);

        if (this.url) {
            this.tileset = this._createTileset(this.style, this.map, this.world, this.loader, this.url, this.loadStatus);
        }

        if (this.subsurfaceLayer) {
            this._addSubsurfaceSupport();
        }

        this.addShadow();
    }

    onRemove(map, gl) {
        // todo: (much) more cleanup?
        this.map.queryRenderedFeatures = this.mapQueryRenderedFeatures;
        this.sceneManager.removeLayer(this);
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

    _createWorld(name) {
        const world = new THREE.Group();
        world.name = name;
        return world;
    }

    _createScene(world) {
        const scene = new THREE.Scene();
        this.lights.forEach((light) => {
            scene.add(light);
        });

        scene.add(world);
        return scene;
    }

    _createTileset(style, map, world, loader, url, loadStatus) {
        const tileset = new TileSet(
            (ts) => {
                if (ts.loaded) {
                    //WIP, poor performance
                    ts.styleParams = style;
                    map.triggerRepaint();
                }
            },
            () => { map.triggerRepaint(); },
            loader
        );

        tileset.load(url, style, this.projectToMercator)
        .then(() => {
            if (tileset.root) {
                world.add(tileset.root.totalContent);
                //world.updateMatrixWorld();
                loadStatus = 1;
                this.sceneManager.addLayer(this);
            }
        })
        .catch((error) => {
            console.error(`${error} (${url})`);
        });

        return tileset;
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

    addShadow() {
        if(this.subsurfaceLayer) {
            return;
        }
        
        if (!this.shadowPlane) {
            var planeGeometry = new THREE.PlaneBufferGeometry(10000, 10000, 1, 1);
            this.shadowMaterial = new THREE.ShadowMaterial();
            this.shadowMaterial.opacity = 0.3;
            this.shadowPlane = new THREE.Mesh(planeGeometry, this.shadowMaterial);
            this.shadowPlane.receiveShadow = true;
        }

        this.scene.add(this.shadowPlane);
        this.renderer.render(this.scene, this.camera);
    }

    removeShadow() {
        if(!this.shadowPlane) {
            return;
        }

        this.scene.remove(this.shadowPlane);
    }

    setShadowOpacity(opacity) {
        if(!this.shadowMaterial) {
            return;
        }

        const newOpacity = opacity < 0 ? 0.0 : opacity > 1 ? 1.0 : opacity;
        this.shadowMaterial.opacity = newOpacity;
    }

    _createLoader() {
        const loader = new GLTFLoader();

        if (this.dracoLoader) {
            loader.setDRACOLoader(this.dracoLoader);
        }

        var ktx2loader = new KTX2Loader();
        loader.setKTX2Loader(ktx2loader);

        return loader;
    }

    setStyle(style) {
        //WIP
        this.style = style
            ? style
            : {
                color: 0xff00ff
            };
        applyStyle(this.world, this.style);
    }

    //ToDo: currently based on default lights, can be overriden by user, handle differently
    setHismphereIntensity(intensity) {
        if (this.lights[0] instanceof THREE.HemisphereLight) {
            const newIntensity = intensity < 0 ? 0.0 : intensity > 1 ? 1.0 : intensity;
            this.lights[0].intensity = newIntensity;
        }
    }

    queryRenderedFeatures(geometry, options) {
        let result = this.mapQueryRenderedFeatures(geometry, options);
        if (!this.map || !this.map.transform) {
            return result;
        }

        if (!(options && options.layers && !options.layers.includes(this.id))) {
            if (geometry && geometry.x && geometry.y) {
                result = this.featureInfo.getAt(result, geometry.x, geometry.y);
            }
        }

        return result;
    }

    _update() {
        this._updateMarkers();
        this.renderer.state.reset();
        this.renderer.render(this.scene, this.camera);
    }

    _updateMarkers() {
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
    }

    update() {
        requestAnimationFrame(() => this._update());
    }

    render() {
        this._update();
    }
}
