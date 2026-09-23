import './style.css';
import * as THREE from 'three';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshBasicMaterial({ color: 0x55aa55 }),
);
scene.add(mesh);

renderer.setAnimationLoop((t) => {
  mesh.rotation.x = t / 1000;
  mesh.rotation.y = t / 1500;
  renderer.render(scene, camera);
});
