import * as THREE from './build/three.module.js';

import Stats from './js/stats.module.js';

import { GUI } from './js/dat.gui.module.js';

import { GPUComputationRenderer } from './js/GPUComputationRenderer.js';
import { VRButton } from './js/VRButton.js';
import { XRControllerModelFactory } from './js/XRControllerModelFactory.js';

let effectController;
let sound;

/* TEXTURE WIDTH FOR SIMULATION */
const WIDTH = 32;

const BIRDS = WIDTH * WIDTH;

// Set to false to remove boids (for debugging)
const showBoids = true;


// Custom Geometry - using 3 triangles each. No UVs, no normals currently.
function BirdGeometry() {
  const triangles = BIRDS * 3;
  const points = triangles * 3;
  THREE.BufferGeometry.call( this );
  const vertices = new THREE.BufferAttribute( new Float32Array( points * 3 ), 3 );
  const birdColors = new THREE.BufferAttribute( new Float32Array( points * 3 ), 3 );
  const references = new THREE.BufferAttribute( new Float32Array( points * 2 ), 2 );
  const birdVertex = new THREE.BufferAttribute( new Float32Array( points ), 1 );
  this.setAttribute( 'position', vertices );
  this.setAttribute( 'birdColor', birdColors );
  this.setAttribute( 'reference', references );
  this.setAttribute( 'birdVertex', birdVertex );

  // this.setAttribute( 'normal', new Float32Array( points * 3 ), 3 );
  let v = 0;
  function verts_push() {
    for ( let i = 0; i < arguments.length; i ++ ) {
      vertices.array[ v ++ ] = arguments[ i ];
    }
  }

  const wingsSpan = 20;
  for ( let f = 0; f < BIRDS; f ++ ) {
    // Body
    verts_push(
      0, - 0, - 20,
      0, 4, - 20,
      0, 0, 30
    );
    // Left Wing
    verts_push(
      0, 0, - 15,
      - wingsSpan, 0, 0,
      0, 0, 15
    );
    // Right Wing
    verts_push(
      0, 0, 15,
      wingsSpan, 0, 0,
      0, 0, - 15
    );
  }

  for ( let v = 0; v < triangles * 3; v ++ ) {
    const i = ~ ~ ( v / 3 );
    const x = ( i % WIDTH ) / WIDTH;
    const y = ~ ~ ( i / WIDTH ) / WIDTH;
    const c = new THREE.Color(
      0x444444 +
        ~ ~ ( v / 9 ) / BIRDS * 0x666666
    );

    birdColors.array[ v * 3 + 0 ] = c.r;
    birdColors.array[ v * 3 + 1 ] = c.g;
    birdColors.array[ v * 3 + 2 ] = c.b;

    references.array[ v * 2 ] = x;
    references.array[ v * 2 + 1 ] = y;

    birdVertex.array[ v ] = v % 9;
  }
  this.scale( 0.2, 0.2, 0.2 );
}

if (showBoids) {
  BirdGeometry.prototype = Object.create( THREE.BufferGeometry.prototype );
}


let container, stats;
let camera, scene, renderer;

const BOUNDS = 800, BOUNDS_HALF = BOUNDS / 2;

let last = performance.now();

let gpuCompute;
let velocityVariable;
let positionVariable;
let positionUniforms;
let velocityUniforms;
let birdUniforms;

let centerOfGravityShader;
let centerOfGravityRenderTarget;
let centerOfGravityImage;
let centerOfGravityCursor;

let cursor1, cursor2, wand1, wand2;
let controller1, controller2;

let birdsFollowLeft = false;
let birdsFollowRight = false;

let cpuPositions = new Float32Array(BIRDS * 3);
let cpuVelocities = new Float32Array(BIRDS * 3);
let lastUpdateTime = 0;
const UPDATE_INTERVAL = 250; // 4Hz = every 250ms

let flockDistributionDisplay;
let lastDistributionUpdateTime = 0;
const DISTRIBUTION_UPDATE_INTERVAL = 250; // 4Hz = every 250ms

init();


//import { xrLog } from './xr-console.module.js';
/*
const formatVec = v => `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
setInterval(() => {
  const dist = camera.position.distanceToSquared(controller1.position);
  const zdist = cursor.position.z;
  const text = `${dist.toFixed(2).toString()}\n${ zdist.toFixed(2)}`;
  xrLog(text, scene);
}, 1000);
*/


animate();


// Skybox stuff
function createPathStrings(filename) {
  const basePath = "./images/";
  const baseFilename = basePath + filename;
  const fileType = ".jpg";

  // in VR view: right, left, top, bottom, back, front
  const sides = ["ft", "bk", "up", "dn", "rt", "lf"];

//  const sides = ["Right", "Left", "Top", "Bottom", "Front", "Back"];

  const pathStrings = sides.map(side => baseFilename + "_" + side + fileType);
  return pathStrings;
}


function createMaterialArray(filename) {
  const skyboxImagepaths = createPathStrings(filename);
  const materialArray = skyboxImagepaths.map(image => {
    let texture = new THREE.TextureLoader().load(image, undefined, undefined, (err) => {
      console.error(`Error loading skybox texture ${image}:`, err);
    });
    return new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide });
  });
  return materialArray;
}


// init everything


function init() {
  container = document.createElement( 'div' );
  document.body.appendChild( container );

  camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, .1, 3000 );
  camera.position.z = 350;

  scene = new THREE.Scene();
  scene.background = new THREE.Color( 0x333399 );
//  scene.fog = new THREE.Fog( 0x333399, 800, 1000 );

  // const floorGeometry = new THREE.PlaneGeometry(25000, 25000, 30, 30);
  // const floorMaterialMesh = new THREE.MeshPhongMaterial({ color: 0x009922, emissive: 0x072534, side: THREE.DoubleSide, flatShading: true });
  // const floor = new THREE.Mesh( floorGeometry, floorMaterialMesh );
  // floor.rotation.x = Math.PI/2;
  // floor.position.y = -300;
  // floor.receiveShadow = true;
  // scene.add( floor );

  let skyboxImage = "afterrain";
  const materialArray = createMaterialArray(skyboxImage);
  const skyboxGeometry = new THREE.BoxGeometry(1000, 1000, 1000);
  const skybox = new THREE.Mesh(skyboxGeometry, materialArray);
  scene.add(skybox);

  console.log("Skybox created");
  console.log("Scene background color:", scene.background);
  console.log("Number of objects in scene:", scene.children.length);

/*
  const spotLight = new THREE.SpotLight( 0xffffff );
  spotLight.position.set( 100, 1000, 100 );
  spotLight.shadow.camera.near = 100;
  spotLight.shadow.camera.far = 10000;
  spotLight.shadow.camera.fov = 50;
  scene.add( spotLight );
*/

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(0, 1, 0);
  scene.add(directionalLight);



  // debug: display center of gravity
  centerOfGravityCursor = new THREE.Mesh(
    new THREE.SphereGeometry( 1, 24, 12 ),
    new THREE.MeshPhongMaterial( { color: 0xFF0000 } )
  );
  scene.add(centerOfGravityCursor);

  renderer = new THREE.WebGLRenderer();
  renderer.xr.enabled = true;
  renderer.setPixelRatio( window.devicePixelRatio );
  renderer.setSize( window.innerWidth, window.innerHeight );
  container.appendChild( renderer.domElement );


  // VR Button
  document.body.appendChild(VRButton.createButton(renderer));

  const toggle1 = () => { birdsFollowRight = !birdsFollowRight; wand1.visible = !wand1.visible };
  const toggle2 = () => { birdsFollowLeft = !birdsFollowLeft; wand2.visible = !wand2.visible };


  controller1 = renderer.xr.getController( 0 );
  controller1.addEventListener('selectstart', toggle1);
  controller1.addEventListener('selectend', toggle1);
  scene.add( controller1 );

  controller2 = renderer.xr.getController( 1 );
  controller2.addEventListener('selectstart', toggle2);
  controller2.addEventListener('selectend', toggle2);
  scene.add( controller2 );

  const controllerModelFactory = new XRControllerModelFactory();

  const controllerGrip1 = renderer.xr.getControllerGrip( 0 );
  controllerGrip1.add( controllerModelFactory.createControllerModel( controllerGrip1 ) );
  scene.add( controllerGrip1 );

  const controllerGrip2 = renderer.xr.getControllerGrip( 1 );
  controllerGrip2.add( controllerModelFactory.createControllerModel( controllerGrip2 ) );
  scene.add( controllerGrip2 );


  const wandGeometry = new THREE.CylinderGeometry( .01, .01, 1, 32 );
  const wandMaterial = new THREE.MeshPhongMaterial({ color: 0xff6666 });
  wand1 = new THREE.Mesh( wandGeometry, wandMaterial );
  wand1.rotation.x = Math.PI/2;
  wand1.position.z = -.5;
  wand1.visible = false;
  controller1.add(wand1);
  wand2 = new THREE.Mesh( wandGeometry, wandMaterial );
  wand2.rotation.x = Math.PI/2;
  wand2.position.z = -.5;
  wand2.visible = false;
  controller2.add(wand2);

  const cursorGeometry = new THREE.SphereGeometry(.1, 8, 8);
  const cursorMaterial = new THREE.MeshPhongMaterial({ color: 0x00ffff });
  cursor1 = new THREE.Mesh(cursorGeometry, cursorMaterial);
  cursor1.position.set(0,0,-5);
  cursor1.visible = false;
  controller1.add(cursor1);
  cursor2 = new THREE.Mesh(cursorGeometry, cursorMaterial);
  cursor2.position.set(0,0,-5);
  cursor2.visible = false;
  controller2.add(cursor2);


  // end VR stuff

  if (showBoids) {
    initComputeRenderer();
  }

  stats = new Stats();
  container.appendChild( stats.dom );
  container.style.touchAction = 'none';


  window.addEventListener( 'resize', onWindowResize );

  let gui;
  if (showBoids) {
    gui = new GUI();

    effectController = {
      separation: 20.0,
      alignment: 20.0,
      cohesion: 20.0,
      freedom: 0.75,
      flockDistribution: 0.5 // New property for flock distribution
    };

    const valuesChanger = function () {
      velocityUniforms[ 'separationDistance' ].value = effectController.separation;
      velocityUniforms[ 'alignmentDistance' ].value = effectController.alignment;
      velocityUniforms[ 'cohesionDistance' ].value = effectController.cohesion;
      velocityUniforms[ 'freedomFactor' ].value = effectController.freedom;
    };

    valuesChanger();

    gui.add( effectController, 'separation', 0.0, 100.0, 1.0 ).onChange( valuesChanger );
    gui.add( effectController, 'alignment', 0.0, 100, 0.001 ).onChange( valuesChanger );
    gui.add( effectController, 'cohesion', 0.0, 100, 0.025 ).onChange( valuesChanger );
    
    // Add flock distribution display
    flockDistributionDisplay = gui.add(effectController, 'flockDistribution', 0, 1).listen();
    if (flockDistributionDisplay) {
      flockDistributionDisplay.domElement.style.pointerEvents = 'none';
      const distributionLabel = flockDistributionDisplay.domElement.parentElement.querySelector('.property-name');
      if (distributionLabel) {
        distributionLabel.textContent = 'Flock Distribution';
      }
    }
    
    gui.close();

    console.log("GUI initialized");

    const button = document.getElementById('VRButton');
    button.addEventListener('click', function() {
      startAudio();
    });
    initBirds();
  }
}

function startAudio() {
  if (!sound) {
    const listener = new THREE.AudioListener();
    camera.add( listener );
    sound = new THREE.PositionalAudio( listener );
    centerOfGravityCursor.add(sound);

    const audioLoader = new THREE.AudioLoader();

    audioLoader.load( 'pinknoise.mp3', function( buffer ) {
      sound.setBuffer( buffer );
      sound.loop = true;
      sound.setRefDistance( 100 );
      sound.play();
    });
  } else if (!sound.isPlaying) {
    sound.play();
  }
}



function initComputeRenderer() {
  gpuCompute = new GPUComputationRenderer( WIDTH, WIDTH, renderer );
  if ( isSafari() ) {
    gpuCompute.setDataType( THREE.HalfFloatType );
  }
  const dtPosition = gpuCompute.createTexture();
  const dtVelocity = gpuCompute.createTexture();
  fillPositionTexture( dtPosition );
  fillVelocityTexture( dtVelocity );

  velocityVariable = gpuCompute.addVariable( 'textureVelocity', document.getElementById( 'fragmentShaderVelocity' ).textContent, dtVelocity );
  positionVariable = gpuCompute.addVariable( 'texturePosition', document.getElementById( 'fragmentShaderPosition' ).textContent, dtPosition );

  gpuCompute.setVariableDependencies( velocityVariable, [positionVariable, velocityVariable] );
  gpuCompute.setVariableDependencies( positionVariable, [positionVariable, velocityVariable] );

  positionUniforms = positionVariable.material.uniforms;
  velocityUniforms = velocityVariable.material.uniforms;

  positionUniforms[ 'time' ] = { value: 0.0 };
  positionUniforms[ 'delta' ] = { value: 0.0 };
  velocityUniforms[ 'time' ] = { value: 1.0 };
  velocityUniforms[ 'delta' ] = { value: 0.0 };
  velocityUniforms[ 'testing' ] = { value: 1.0 };
  velocityUniforms[ 'separationDistance' ] = { value: 1.0 };
  velocityUniforms[ 'alignmentDistance' ] = { value: 1.0 };
  velocityUniforms[ 'cohesionDistance' ] = { value: 1.0 };
  velocityUniforms[ 'freedomFactor' ] = { value: 1.0 };
  velocityUniforms[ 'predator1' ] = { value: new THREE.Vector3(0, 100, -300) };
  velocityUniforms[ 'predator2' ] = { value: new THREE.Vector3(0, 100, -300) };
  velocityVariable.material.defines.BOUNDS = BOUNDS.toFixed( 2 );

  velocityVariable.wrapS = THREE.RepeatWrapping;
  velocityVariable.wrapT = THREE.RepeatWrapping;
  positionVariable.wrapS = THREE.RepeatWrapping;
  positionVariable.wrapT = THREE.RepeatWrapping;

  const error = gpuCompute.init();

  if ( error !== null ) {
    console.error( error );
  }

  // Create compute shader to read water level
  centerOfGravityShader = gpuCompute.createShaderMaterial( document.getElementById( 'centerOfGravityFragmentShader' ).textContent, {
    levelTexture: { value: null }
  } );
  centerOfGravityShader.defines.WIDTH = WIDTH.toFixed( 1 );
  centerOfGravityShader.defines.BOUNDS = BOUNDS.toFixed( 1 );

  // Create a 4x1 pixel image and a render target (Uint8, 4 channels, 1 byte per channel) to read water height and orientation
  centerOfGravityImage = new Uint8Array( 4 * 1 * 4 );

  centerOfGravityRenderTarget = new THREE.WebGLRenderTarget( 4, 1, {
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false
  } );



}

function isSafari() {
  return !! navigator.userAgent.match( /Safari/i ) && ! navigator.userAgent.match( /Chrome/i );
}

function initBirds() {

  const geometry = new BirdGeometry();

  // For Vertex and Fragment
  birdUniforms = {
    'color': { value: new THREE.Color( 0xff2200 ) },
    'texturePosition': { value: null },
    'textureVelocity': { value: null },
    'time': { value: 1.0 },
    'delta': { value: 0.0 }
  };

  // THREE.ShaderMaterial
  const material = new THREE.ShaderMaterial( {
    uniforms: birdUniforms,
    vertexShader: document.getElementById( 'birdVS' ).textContent,
    fragmentShader: document.getElementById( 'birdFS' ).textContent,
    side: THREE.DoubleSide
  } );

  const birdMesh = new THREE.Mesh( geometry, material );
  birdMesh.rotation.y = Math.PI / 2;
  birdMesh.matrixAutoUpdate = false;
  birdMesh.updateMatrix();

  scene.add( birdMesh );
}

function fillPositionTexture( texture ) {
  const theArray = texture.image.data;
  for ( let k = 0, kl = theArray.length; k < kl; k += 4 ) {
    const x = Math.random() * BOUNDS/4;
    const y = Math.random() * BOUNDS/4;
    const z = Math.random() * BOUNDS/8 - BOUNDS/2;
    theArray[ k + 0 ] = x;
    theArray[ k + 1 ] = y;
    theArray[ k + 2 ] = z;
    theArray[ k + 3 ] = 1;
  }
}

function fillVelocityTexture( texture ) {
  const theArray = texture.image.data;
  for ( let k = 0, kl = theArray.length; k < kl; k += 4 ) {
    const x = Math.random() - 0.5;
    const y = Math.random() - 0.5;
    const z = Math.random() - 0.5;
    theArray[ k + 0 ] = x * 10;
    theArray[ k + 1 ] = y * 10;
    theArray[ k + 2 ] = z * 10;
    theArray[ k + 3 ] = 1;
  }
}


function centerOfGravity() {

  // push the current position texture to centerOfGravityFragmentShader
  const currentRenderTarget = gpuCompute.getCurrentRenderTarget(positionVariable);
  centerOfGravityShader.uniforms[ 'levelTexture' ].value = currentRenderTarget.texture;


  // run the shader
  gpuCompute.doRenderTarget( centerOfGravityShader, centerOfGravityRenderTarget );


  // retrieve the results
  renderer.readRenderTargetPixels(
    centerOfGravityRenderTarget,
    0, 0, 4, 1, // x, y, width, height
    centerOfGravityImage );
  const pixels = new Float32Array( centerOfGravityImage.buffer );

  return new THREE.Vector3(pixels[0], pixels[1], pixels[2]);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize( window.innerWidth, window.innerHeight );
}

function animate() {
  render();
  stats.update();
}

renderer.setAnimationLoop(animate);


function render() {
  const now = performance.now();

  // update cursors and wands depending on controller positions
  const dist1 = camera.position.distanceToSquared(controller1.position);
  const dist2 = camera.position.distanceToSquared(controller2.position);

  cursor1.position.z = dist1 < 0.2 ? 0 : -300;
  cursor2.position.z = dist2 < 0.2 ? 0 : -300;

//  wand1.scale.z = -cursor1.position.z;
//  wand2.scale.z = -cursor2.position.z;

  if (showBoids) {
    let delta = ( now - last ) / 1000;
    const cwp1 = new THREE.Vector3(0,0,0);
    const cwp2 = new THREE.Vector3(0,0,0);

    if ( delta > 1 ) delta = 1; // safety cap on large deltas
    last = now;

    positionUniforms[ 'time' ].value = now;
    positionUniforms[ 'delta' ].value = delta;
    velocityUniforms[ 'time' ].value = now;
    velocityUniforms[ 'delta' ].value = delta;

    birdUniforms[ 'time' ].value = now;
    birdUniforms[ 'delta' ].value = delta;

    cursor1.getWorldPosition(cwp1);
    cursor2.getWorldPosition(cwp2);

    if (birdsFollowLeft) {
      if (birdsFollowRight) {
        velocityUniforms[ 'predator1' ].value.set(cwp2.x, cwp2.y, cwp2.z);
        velocityUniforms[ 'predator2' ].value.set(cwp1.x, cwp1.y, cwp1.z);
      } else {
        velocityUniforms[ 'predator1' ].value.set(cwp2.x, cwp2.y, cwp2.z);
        velocityUniforms[ 'predator2' ].value.set(cwp2.x, cwp2.y, cwp2.z);
      }
    } else {
      if (birdsFollowRight) {
        velocityUniforms[ 'predator1' ].value.set(cwp1.x, cwp1.y, cwp1.z);
        velocityUniforms[ 'predator2' ].value.set(cwp1.x, cwp1.y, cwp1.z);
      } else {
        velocityUniforms[ 'predator1' ].value.set(0, -100, -300);
        velocityUniforms[ 'predator2' ].value.set(0, -100, -300);
      }
    }

    renderer.xr.enabled = false;
    gpuCompute.compute();
    birdUniforms[ 'texturePosition' ].value =
      gpuCompute.getCurrentRenderTarget( positionVariable ).texture;
    birdUniforms[ 'textureVelocity' ].value =
      gpuCompute.getCurrentRenderTarget( velocityVariable ).texture;
    renderer.xr.enabled = true;

    const cog = centerOfGravity();
    centerOfGravityCursor.position.x = cog.x;
    centerOfGravityCursor.position.y = cog.y;
    centerOfGravityCursor.position.z = cog.z;

    if (now - lastUpdateTime > UPDATE_INTERVAL) {
      updateCPUData();
      lastUpdateTime = now;
    }

    // Update flock distribution every 250ms (4Hz)
    if (now - lastDistributionUpdateTime > DISTRIBUTION_UPDATE_INTERVAL) {
      try {
        updateFlockDistribution();
      } catch (error) {
        console.error("Error updating flock distribution:", error);
      }
      lastDistributionUpdateTime = now;
    }
  }
  renderer.render( scene, camera );
}

function updateCPUData() {
  const positionData = gpuCompute.getTextureData(positionVariable);
  const velocityData = gpuCompute.getTextureData(velocityVariable);

  for (let i = 0; i < BIRDS; i++) {
    cpuPositions[i*3] = positionData[i*4];
    cpuPositions[i*3+1] = positionData[i*4+1];
    cpuPositions[i*3+2] = positionData[i*4+2];

    cpuVelocities[i*3] = velocityData[i*4];
    cpuVelocities[i*3+1] = velocityData[i*4+1];
    cpuVelocities[i*3+2] = velocityData[i*4+2];
  }

  // Here you can do something with the CPU data, like sending it to a server or processing it
  console.log("CPU data updated");
}

function getBoidData(index) {
  if (index < 0 || index >= BIRDS) {
    console.error("Invalid boid index");
    return null;
  }
  return {
    position: {
      x: cpuPositions[index*3],
      y: cpuPositions[index*3+1],
      z: cpuPositions[index*3+2]
    },
    velocity: {
      x: cpuVelocities[index*3],
      y: cpuVelocities[index*3+1],
      z: cpuVelocities[index*3+2]
    }
  };
}

function updateFlockDistribution() {
  const cameraDirection = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const cameraQuaternion = new THREE.Quaternion();

  // Check if we're in VR mode
  if (renderer.xr.isPresenting) {
    // Get the VR camera's world position and orientation
    renderer.xr.getCamera(camera).getWorldPosition(cameraPosition);
    renderer.xr.getCamera(camera).getWorldQuaternion(cameraQuaternion);

    // Calculate the forward direction of the VR camera
    cameraDirection.set(0, 0, -1).applyQuaternion(cameraQuaternion);
  } else {
    // Use the regular camera for non-VR mode
    camera.getWorldPosition(cameraPosition);
    camera.getWorldQuaternion(cameraQuaternion);
    camera.getWorldDirection(cameraDirection);
  }
  
  let leftCount = 0;
  let rightCount = 0;
  
  for (let i = 0; i < BIRDS; i++) {
    const boidPosition = new THREE.Vector3(
      cpuPositions[i*3],
      cpuPositions[i*3+1],
      cpuPositions[i*3+2]
    );
    
    const toBoid = new THREE.Vector3().subVectors(boidPosition, cameraPosition);
    const crossProduct = new THREE.Vector3().crossVectors(cameraDirection, toBoid);
    
    if (crossProduct.y > 0) {
      rightCount++;
    } else {
      leftCount++;
    }
  }
  
  const totalCount = leftCount + rightCount;
  const distribution = rightCount / totalCount;
  
  // Update the GUI display
  if (effectController) {
    effectController.flockDistribution = distribution;
  }
  
  // Update the visual representation
  if (flockDistributionDisplay) {
    const barElement = flockDistributionDisplay.domElement.querySelector('.c');
    if (barElement) {
      barElement.style.background = `linear-gradient(to right, #00ff00 ${distribution * 100}%, #ff0000 ${distribution * 100}%)`;
    }
  }
}
